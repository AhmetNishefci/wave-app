import { useEffect, useRef } from "react";
import { supabase } from "@/services/supabase";
import { useBleStore } from "@/stores/bleStore";
import { logger } from "@/utils/logger";

const POLL_INTERVAL_MS = 30_000;
const FULL_REFRESH_TICKS = 4;

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
                })),
              );
            }
          } else {
            logger.error("resolve_peer_data RPC error", error);
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
        }[];

        processNotes(batchedTokens, rows);
      } catch (err) {
        logger.error("useNoteResolver tick error", err);
      } finally {
        inFlightRef.current = false;
      }
    };

    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isDiscoveryActive]);
}

function processNotes(
  batchedTokens: string[],
  rows: { token: string; note: string | null; peer_user_id: string | null; is_blocked: boolean }[],
): void {
  const dataMap = new Map<string, { note: string | null; userId: string | null }>();
  const blockedTokens = new Set<string>();

  for (const row of rows) {
    dataMap.set(row.token, { note: row.note, userId: row.peer_user_id });
    if (row.is_blocked) {
      blockedTokens.add(row.token);
    }
  }

  // Tokens queried but not returned — clear stale data
  for (const token of batchedTokens) {
    if (!dataMap.has(token)) {
      dataMap.set(token, { note: null, userId: null });
    }
  }

  useBleStore.setState((state) => {
    const next = new Map(state.nearbyPeers);
    let changed = false;

    for (const [token, { note, userId }] of dataMap) {
      // Remove blocked peers from the radar
      if (blockedTokens.has(token)) {
        if (next.has(token)) {
          next.delete(token);
          changed = true;
        }
        continue;
      }

      const peer = next.get(token);
      if (peer && (peer.note !== note || peer.userId !== userId)) {
        next.set(token, { ...peer, note, userId });
        changed = true;
      }
    }

    return changed ? { nearbyPeers: next } : state;
  });
}
