import { supabase, invokeWithTimeout } from "../supabase";
import type { WaveResult, Match } from "@/types";
import { logger } from "@/utils/logger";
import { getFreshSession } from "./session";
import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { WAVE_EXPIRY_MINUTES } from "@/services/ble/constants";

/** Result returned by sendWave with optional match data */
export interface SendWaveResult {
  status: WaveResult;
  match?: Match;
  targetUserId?: string;
}

// ─── Offline Wave Queue ────────────────────────────────────────
// When a wave fails due to no network, queue the token and retry
// when connectivity is restored. Queued waves expire after 15 min
// (matching server-side wave lifetime).
//
// Persisted to AsyncStorage so waves survive app kills (e.g. iOS
// memory pressure in crowded venues). Expired entries are filtered
// on load — only waves within the 15-min server-side lifetime retry.

const WAVE_QUEUE_EXPIRY_MS = WAVE_EXPIRY_MINUTES * 60_000;
const QUEUE_STORAGE_KEY = "@wave_offline_queue";

interface QueuedWave {
  token: string;
  queuedAt: number;
}

let offlineQueue: QueuedWave[] = [];
let networkUnsubscribe: (() => void) | null = null;

/** Persist the current queue to AsyncStorage (non-blocking, non-fatal). */
function persistQueue(): void {
  AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(offlineQueue)).catch(() => {});
}

/** Load persisted queue on module init. Discards expired entries. */
(async function loadPersistedQueue(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
    if (!stored) return;
    const parsed: QueuedWave[] = JSON.parse(stored);
    const now = Date.now();
    const valid = parsed.filter((w) => now - w.queuedAt < WAVE_QUEUE_EXPIRY_MS);
    if (valid.length > 0) {
      offlineQueue = valid;
      startNetworkListener();
      logger.wave("Restored offline wave queue", { count: valid.length });
    }
    if (valid.length !== parsed.length) {
      persistQueue();
    }
  } catch {
    // Non-fatal — queue starts empty
  }
})();

function startNetworkListener(): void {
  if (networkUnsubscribe) return;
  networkUnsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected && offlineQueue.length > 0) {
      flushOfflineQueue();
    }
  });
}

function stopNetworkListenerIfEmpty(): void {
  if (offlineQueue.length === 0 && networkUnsubscribe) {
    networkUnsubscribe();
    networkUnsubscribe = null;
  }
}

/**
 * Clear the offline wave queue and tear down the network listener.
 * Called on sign-out to prevent stale waves from a previous session
 * leaking into a new user's session.
 */
export function clearOfflineQueue(): void {
  offlineQueue = [];
  persistQueue();
  stopNetworkListenerIfEmpty();
}

const FLUSH_STAGGER_MS = 3_000; // Stagger retries to avoid rate-limit burst

async function flushOfflineQueue(): Promise<void> {
  const now = Date.now();
  // Filter out expired queued waves
  const valid = offlineQueue.filter((w) => now - w.queuedAt < WAVE_QUEUE_EXPIRY_MS);
  offlineQueue = [];
  persistQueue();

  for (let i = 0; i < valid.length; i++) {
    const queued = valid[i];
    logger.wave("Retrying queued offline wave", { token: queued.token.substring(0, 8) });

    // Stagger retries after the first to avoid hitting 20/min rate limit
    if (i > 0) {
      await new Promise((r) => setTimeout(r, FLUSH_STAGGER_MS));
    }

    sendWave(queued.token).catch((e) =>
      logger.warn("Offline wave retry failed", e),
    );
  }

  stopNetworkListenerIfEmpty();
}

/**
 * Send a wave at a nearby peer identified by their ephemeral token.
 * Returns the wave result status and optional match data.
 * The caller is responsible for updating the store based on the result.
 * If offline, queues the wave for automatic retry when network returns.
 */
export async function sendWave(
  targetEphemeralToken: string,
): Promise<SendWaveResult> {
  try {
    const session = await getFreshSession();
    if (!session) {
      logger.warn("Cannot send wave: no active session");
      return { status: "error" };
    }

    const { data, error } = await invokeWithTimeout("send-wave", {
      body: { target_ephemeral_token: targetEphemeralToken },
    });

    if (error) {
      // Check if this is a network error — queue for retry if offline
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        logger.wave("Wave failed while offline, queuing for retry", {
          token: targetEphemeralToken.substring(0, 8),
        });
        // Dedup: don't queue the same token twice
        if (!offlineQueue.some((w) => w.token === targetEphemeralToken)) {
          offlineQueue.push({ token: targetEphemeralToken, queuedAt: Date.now() });
          persistQueue();
        }
        startNetworkListener();
        return { status: "pending" };
      }

      logger.warn("Wave failed (retryable)", error);
      return { status: "error" };
    }

    const result = data as {
      status: string;
      match_id?: string;
      matched_user_id?: string;
      target_user_id?: string;
      instagram_handle?: string;
      snapchat_handle?: string;
      reason?: string;
    };

    logger.wave("Wave result", result);

    if (result.status === "match" && result.match_id && result.matched_user_id) {
      const match: Match = {
        matchId: result.match_id,
        matchedUserId: result.matched_user_id,
        instagramHandle: result.instagram_handle ?? undefined,
        snapchatHandle: result.snapchat_handle ?? undefined,
        createdAt: new Date().toISOString(),
        seen: false,
      };
      return { status: "match", match };
    }

    if (result.status === "pending") {
      return { status: "pending", targetUserId: result.target_user_id };
    }

    if (result.status === "already_matched") {
      if (result.match_id && result.matched_user_id) {
        const match: Match = {
          matchId: result.match_id,
          matchedUserId: result.matched_user_id,
          instagramHandle: result.instagram_handle ?? undefined,
          snapchatHandle: result.snapchat_handle ?? undefined,
          createdAt: new Date().toISOString(),
          seen: true,
        };
        return { status: "already_matched", match };
      }
      return { status: "already_matched" };
    }

    if (result.status === "error" && result.reason === "rate_limited") {
      return { status: "rate_limited" };
    }

    if (result.status === "error" && result.reason === "blocked") {
      return { status: "blocked" };
    }

    if (result.status === "error" && result.reason === "invalid_or_expired_token") {
      return { status: "expired_token" };
    }

    return { status: "error" };
  } catch (error) {
    logger.warn("Wave error (retryable)", error);
    return { status: "error" };
  }
}

/**
 * Undo a wave that was sent within the undo window.
 * Deletes the wave record server-side.
 */
export async function undoWave(
  targetEphemeralToken: string,
): Promise<boolean> {
  try {
    const session = await getFreshSession();

    if (!session) return false;

    const { data, error } = await invokeWithTimeout("send-wave", {
      body: {
        target_ephemeral_token: targetEphemeralToken,
        action: "undo",
      },
    });

    if (error) {
      // Distinguish transient/expected errors from genuine failures.
      // A 400 (undo_expired) is expected — user tapped undo too late.
      // Network/timeout errors are genuine failures worth alerting.
      logger.warn("Undo wave failed", error);
      return false;
    }

    // Check the response data for undo_expired — supabase.functions.invoke
    // treats non-5xx as success, so a 400 response with undo_expired
    // comes back as `data`, not `error` (C8 fix)
    const result = data as { status?: string; reason?: string } | null;
    if (result?.status === "error" && result?.reason === "undo_expired") {
      logger.wave("Undo failed: wave already consumed or expired");
      return false;
    }

    logger.wave("Wave undone", { token: targetEphemeralToken.substring(0, 8) });
    return true;
  } catch (error) {
    logger.warn("Undo wave error", error);
    return false;
  }
}

/**
 * Remove a match server-side. Deletes the match row for both users
 * and broadcasts a match_removed event to the other user.
 * Returns true if successfully removed.
 */
export async function removeMatchFromServer(matchId: string): Promise<boolean> {
  try {
    const session = await getFreshSession();
    if (!session) return false;

    const { error } = await invokeWithTimeout("remove-match", {
      body: { match_id: matchId },
    });

    if (error) {
      logger.warn("Remove match failed (retryable)", error);
      return false;
    }

    logger.wave("Match removed", { matchId });
    return true;
  } catch (error) {
    logger.warn("Remove match error (retryable)", error);
    return false;
  }
}

/**
 * Block a user. Optionally reports them and removes any existing match.
 * The blocked user won't appear on radar and can't wave at the blocker.
 * Callers are responsible for updating the local store (e.g. removing the match).
 */
export interface BlockUserResult {
  success: boolean;
  reportCreated?: boolean;
}

export async function blockUser(params: {
  blockedId: string;
  displayName?: string;
  matchId?: string;
  reason?: string;
  details?: string;
}): Promise<BlockUserResult> {
  try {
    const session = await getFreshSession();
    if (!session) return { success: false };

    const { data, error } = await invokeWithTimeout("block-user", {
      body: {
        blocked_id: params.blockedId,
        display_name: params.displayName,
        match_id: params.matchId,
        reason: params.reason,
        details: params.details,
      },
    });

    if (error) {
      logger.warn("Block user failed (retryable)", error);
      return { success: false };
    }

    logger.wave("User blocked", { blockedId: params.blockedId });
    return {
      success: true,
      reportCreated: (data as { report_created?: boolean })?.report_created ?? false,
    };
  } catch (error) {
    logger.warn("Block user error (retryable)", error);
    return { success: false };
  }
}

/**
 * Unblock a user via RPC.
 */
export async function unblockUser(blockedId: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("unblock_user", {
      p_blocked_id: blockedId,
    });

    if (error) {
      logger.warn("Unblock user failed (retryable)", error);
      return false;
    }

    logger.wave("User unblocked", { blockedId });
    return true;
  } catch (error) {
    logger.warn("Unblock user error (retryable)", error);
    return false;
  }
}

/**
 * Fetch the list of blocked users for the settings screen.
 */
export async function getBlockedUsers(): Promise<
  { blockedId: string; displayName: string | null; createdAt: string }[]
> {
  try {
    const { data, error } = await supabase.rpc("get_blocked_users");

    if (error) {
      logger.warn("Get blocked users failed (retryable)", error);
      return [];
    }

    return (data ?? []).map((row: any) => ({
      blockedId: row.blocked_id,
      displayName: row.blocked_display_name,
      createdAt: row.created_at,
    }));
  } catch (error) {
    logger.warn("Get blocked users error (retryable)", error);
    return [];
  }
}
