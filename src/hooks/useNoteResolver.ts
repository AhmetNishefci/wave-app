import { useEffect, useRef } from "react";
import { supabase } from "@/services/supabase";
import { useBleStore } from "@/stores/bleStore";
import { useMatchStore } from "@/stores/matchStore";
import type { NearbyPeer } from "@/types";
import { logger } from "@/utils/logger";

const POLL_INTERVAL_MS = 30_000;
const FULL_REFRESH_TICKS = 2; // Re-check all peers every 60s (2 × 30s) for block status updates

/**
 * Polls the server to resolve peer notes AND block status for tokens
 * discovered via BLE. Uses the resolve_peer_data RPC which returns
 * note, user_id, and is_blocked for each token.
 *
 * Blocked peers are removed from the nearbyPeers map so they don't
 * appear on the radar.
 */
export function useNoteResolver(isDiscoveryActive: boolean): void {
  const resolvedRef = useRef<Set<string>>(new Set());
  const tickCountRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!isDiscoveryActive) {
      resolvedRef.current.clear();
      tickCountRef.current = 0;
    }
  }, [isDiscoveryActive]);

  useEffect(() => {
    if (!isDiscoveryActive) return;

    const tick = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      try {
        const peers = useBleStore.getState().nearbyPeers;
        tickCountRef.current += 1;

        const isFullRefresh = tickCountRef.current % FULL_REFRESH_TICKS === 0;
        if (isFullRefresh) {
          resolvedRef.current.clear();
        }

        const unresolvedTokens: string[] = [];
        for (const token of peers.keys()) {
          if (!resolvedRef.current.has(token)) {
            unresolvedTokens.push(token);
          }
        }

        for (const token of Array.from(resolvedRef.current)) {
          if (!peers.has(token)) {
            resolvedRef.current.delete(token);
          }
        }

        if (unresolvedTokens.length === 0) return;

        const MAX_BATCH = 30;
        const batchedTokens = unresolvedTokens.slice(0, MAX_BATCH);

        // Use resolve_peer_data which returns notes + block status
        const { data, error } = await supabase.rpc("resolve_peer_data", {
          p_tokens: batchedTokens,
        });

        if (error) {
          // Fall back to old RPC if new one doesn't exist yet (backward compat)
          if (error.message?.includes("resolve_peer_data")) {
            const { data: fallbackData, error: fallbackError } = await supabase.rpc(
              "resolve_peer_notes",
              { p_tokens: batchedTokens },
            );
            if (!fallbackError && fallbackData) {
              // Process notes only (no block data)
              processNotes(
                batchedTokens,
                (fallbackData as { token: string; note: string | null }[]).map((r) => ({
                  token: r.token,
                  note: r.note,
                  peer_user_id: null,
                  is_blocked: false,
                  peer_gender_preference: null,
                  peer_age_preference_min: null,
                  peer_age_preference_max: null,
                })),
              );
            }
          } else {
            logger.warn("resolve_peer_data RPC error", error);
          }
          return;
        }

        for (const token of batchedTokens) {
          resolvedRef.current.add(token);
        }

        const rows = data as {
          token: string;
          note: string | null;
          peer_user_id: string | null;
          is_blocked: boolean;
          peer_gender_preference: string | null;
          peer_age_preference_min: number | null;
          peer_age_preference_max: number | null;
        }[];

        processNotes(batchedTokens, rows);
      } catch (err) {
        logger.warn("useNoteResolver tick error", err);
      } finally {
        inFlightRef.current = false;
      }
    };

    tick();
    // Fast second tick: BLE needs a few seconds to discover peers after
    // discovery starts. The immediate tick() above usually finds no peers yet.
    // This catches peers discovered in the first few seconds and resolves their
    // userId, notes, blocks, and preferences quickly (~3s instead of ~30s).
    const earlyTick = setTimeout(tick, 2_000);
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(earlyTick);
      clearInterval(interval);
    };
  }, [isDiscoveryActive]);
}

interface PeerRow {
  token: string;
  note: string | null;
  peer_user_id: string | null;
  is_blocked: boolean;
  peer_gender_preference?: string | null;
  peer_age_preference_min?: number | null;
  peer_age_preference_max?: number | null;
}

function processNotes(batchedTokens: string[], rows: PeerRow[]): void {
  const dataMap = new Map<
    string,
    {
      note: string | null;
      userId: string | null;
      genderPreference: string | null;
      agePreferenceMin: number | null;
      agePreferenceMax: number | null;
    }
  >();
  const blockedTokens = new Set<string>();

  for (const row of rows) {
    dataMap.set(row.token, {
      note: row.note,
      userId: row.peer_user_id,
      genderPreference: row.peer_gender_preference ?? null,
      agePreferenceMin: row.peer_age_preference_min ?? null,
      agePreferenceMax: row.peer_age_preference_max ?? null,
    });
    if (row.is_blocked) {
      blockedTokens.add(row.token);
      if (row.peer_user_id) {
        useBleStore.getState().addBlockedUserId(row.peer_user_id);
      }
    }
  }

  // Tokens queried but not returned — clear stale data
  for (const token of batchedTokens) {
    if (!dataMap.has(token)) {
      dataMap.set(token, {
        note: null,
        userId: null,
        genderPreference: null,
        agePreferenceMin: null,
        agePreferenceMax: null,
      });
    }
  }

  useBleStore.setState((state) => {
    const next = new Map(state.nearbyPeers);
    let changed = false;

    for (const [token, { note, userId, genderPreference, agePreferenceMin, agePreferenceMax }] of dataMap) {
      // Remove blocked peers from the radar
      if (blockedTokens.has(token)) {
        if (next.has(token)) {
          next.delete(token);
          changed = true;
        }
        continue;
      }

      const peer = next.get(token);
      if (!peer) continue;

      const needsUpdate =
        peer.note !== note ||
        peer.userId !== userId ||
        peer.genderPreference !== genderPreference ||
        peer.agePreferenceMin !== agePreferenceMin ||
        peer.agePreferenceMax !== agePreferenceMax;

      if (needsUpdate) {
        next.set(token, {
          ...peer,
          note,
          userId,
          genderPreference: genderPreference as NearbyPeer["genderPreference"],
          agePreferenceMin,
          agePreferenceMax,
        });
        changed = true;

        // Dedup: if another token already maps to the same userId, evict the stale one.
        // This happens when a user kills and reopens the app — they get a new token but
        // the old token's peer entry is still in the map until pruneStale removes it.
        if (userId) {
          for (const [otherToken, otherPeer] of next) {
            if (otherToken !== token && otherPeer.userId === userId) {
              next.delete(otherPeer.lastSeen < peer.lastSeen ? otherToken : token);
              break;
            }
          }
        }
      }
    }

    return changed ? { nearbyPeers: next } : state;
  });

  // Bridge: sync matchedTokens from persisted matches.
  // After app restart or token rotation, matchedTokens is empty but matchesById
  // is persisted. When a peer's userId is resolved, check if they're a match and
  // re-add their current token to matchedTokens so PeerRow shows "Matched".
  const matchState = useMatchStore.getState();
  for (const [token, { userId }] of dataMap) {
    if (userId && !blockedTokens.has(token) && !matchState.matchedTokens.has(token)) {
      for (const m of matchState.matchesById.values()) {
        if (m.matchedUserId === userId) {
          useMatchStore.getState().addMatchedToken(token);
          break;
        }
      }
    }
  }
}
