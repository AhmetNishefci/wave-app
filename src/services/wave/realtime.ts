import { supabase } from "../supabase";
import { useWaveStore } from "@/stores/waveStore";
import { useMatchStore } from "@/stores/matchStore";
import { useBleStore } from "@/stores/bleStore";
import { logger } from "@/utils/logger";
import NetInfo from "@react-native-community/netinfo";
import type { RealtimeChannel } from "@supabase/supabase-js";

let channel: RealtimeChannel | null = null;
let currentUserId: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;

/**
 * Subscribe to match AND wave events for the given user.
 * - "match" events: add match to store so the match screen triggers.
 * - "wave" events: increment incoming wave counter (anonymous notification).
 * - "wave_undo" events: decrement incoming wave counter.
 * - "match_removed" events: remove match from store.
 *
 * Handles reconnection on subscription errors and session refresh.
 */
export function subscribeToMatches(userId: string): void {
  // If already subscribed to the same user, skip
  if (channel && currentUserId === userId) {
    logger.wave("Already subscribed to realtime");
    return;
  }

  // Clean up any existing subscription before creating a new one
  cleanupChannel();
  currentUserId = userId;

  createChannel(userId);
}

function createChannel(userId: string): void {
  channel = supabase
    .channel(`user:${userId}`)
    .on("broadcast", { event: "match" }, (payload) => {
      logger.wave("Match event received!", payload);

      const data = payload.payload as {
        match_id: string;
        matched_user_id: string;
        created_at?: string;
      };

      if (data.match_id && data.matched_user_id) {
        // Add match immediately (without handle) so the celebration screen triggers
        useMatchStore.getState().addMatch({
          matchId: data.match_id,
          matchedUserId: data.matched_user_id,
          instagramHandle: undefined,
          createdAt: data.created_at ?? new Date().toISOString(),
          seen: false,
        });

        // Clean up the matched user's wave token from incomingWaveTokens (V6 fix).
        // When a match is created, the "Wave back" badge is stale — remove the
        // incoming wave token so PeerRow shows "Matched" immediately, not both
        // "Waved at you" and "Matched" simultaneously.
        const peers = useBleStore.getState().nearbyPeers;
        const waveStore = useWaveStore.getState();
        for (const [token, peer] of peers) {
          if (peer.userId === data.matched_user_id && waveStore.incomingWaveTokens.includes(token)) {
            useWaveStore.getState().removeIncomingWaveToken(token);
          }
        }

        // Fetch the handle via authenticated RPC (not from broadcast payload)
        fetchMatchHandle(data.match_id).catch((err) =>
          logger.error("Failed to fetch match handle after realtime event", err),
        );
      }
    })
    .on("broadcast", { event: "wave" }, (payload) => {
      logger.wave("Incoming wave event!", payload);
      const data = payload.payload as { waver_token?: string };
      if (data.waver_token) {
        useWaveStore.getState().addIncomingWaveToken(data.waver_token);
      }
    })
    .on("broadcast", { event: "wave_undo" }, (payload) => {
      logger.wave("Wave undo event received", payload);
      const data = payload.payload as { waver_token?: string; waver_tokens?: string[] };
      // Handle both array (new) and single token (backward compat).
      // The waver may have rotated tokens since sending the original wave,
      // so the server sends all recent tokens to ensure we find the right one.
      const tokens = data.waver_tokens ?? (data.waver_token ? [data.waver_token] : []);
      for (const t of tokens) {
        useWaveStore.getState().removeIncomingWaveToken(t);
      }
    })
    .on("broadcast", { event: "match_removed" }, (payload) => {
      logger.wave("Match removed event received", payload);
      const data = payload.payload as { match_id?: string };
      if (data.match_id) {
        useMatchStore.getState().removeMatch(data.match_id);
      }
    })
    .subscribe((status, err) => {
      logger.wave("Realtime subscription status", { status });

      if (status === "SUBSCRIBED") {
        reconnectAttempts = 0; // Reset backoff on success
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        logger.warn("Realtime subscription error, scheduling reconnect", err);
        scheduleReconnect(userId);
      }

      if (status === "CLOSED") {
        // Channel was closed externally — only reconnect if we still want it
        if (currentUserId === userId) {
          logger.wave("Realtime channel closed unexpectedly, reconnecting");
          scheduleReconnect(userId);
        }
      }
    });
}

/**
 * Schedule a reconnection attempt with a delay to avoid rapid reconnect loops.
 */
function scheduleReconnect(userId: string): void {
  if (reconnectTimer) return; // Already scheduled

  // Exponential backoff: 3s, 6s, 12s, 24s, ... capped at 60s
  const delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts),
    RECONNECT_MAX_MS,
  );
  reconnectAttempts++;

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (currentUserId !== userId) return; // User changed, skip

    // Skip reconnect attempt if device is offline — wait for next scheduled retry
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      logger.wave("Skipping realtime reconnect — device is offline");
      scheduleReconnect(userId);
      return;
    }

    logger.wave(`Attempting realtime reconnect (attempt ${reconnectAttempts})`);
    cleanupChannel();
    createChannel(userId);
  }, delay);
}

function cleanupChannel(): void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}

/**
 * Unsubscribe from realtime events.
 */
export function unsubscribeFromMatches(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  currentUserId = null;
  cleanupChannel();
  logger.wave("Unsubscribed from realtime");
}

/**
 * Fetch the matched user's contact handles via authenticated RPC.
 * Retries up to 3 times with exponential backoff (1s, 2s, 4s).
 * Updates the match in the store once retrieved.
 */
async function fetchMatchHandle(matchId: string): Promise<void> {
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { data, error } = await supabase.rpc("get_matched_contact_handles", {
      p_match_ids: [matchId],
    });

    if (error) {
      logger.warn(`RPC get_matched_contact_handles failed (attempt ${attempt + 1})`, error);
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      return;
    }

    const row = (data as { match_id: string; instagram_handle: string | null; snapchat_handle: string | null }[] | null)?.[0];
    const handles: { instagramHandle?: string; snapchatHandle?: string } = {};
    if (row?.instagram_handle) handles.instagramHandle = row.instagram_handle;
    if (row?.snapchat_handle) handles.snapchatHandle = row.snapchat_handle;

    if (handles.instagramHandle || handles.snapchatHandle) {
      useMatchStore.getState().updateMatchHandles(matchId, handles);
      logger.wave("Match handles fetched via RPC", { matchId, handles });
    }
    return;
  }
}
