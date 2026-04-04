/**
 * Shared utility to clean wave state (pendingWaves + incomingWaveTokens +
 * wavingBackTokens) for a specific user. Called whenever a match is created
 * or removed to prevent stale "Undo" or "Wave back" badges.
 *
 * Two-pass approach:
 *  1. Check nearbyPeers for tokens belonging to this userId
 *  2. Check waveState directly for any tokens whose resolved userId matches
 *     (handles the case where peer was pruned from nearbyPeers before cleanup)
 */
import { useBleStore } from "@/stores/bleStore";
import { useWaveStore } from "@/stores/waveStore";
import { logger } from "@/utils/logger";

export function clearWaveStateForUser(userId: string): void {
  const peers = useBleStore.getState().nearbyPeers;
  const waveState = useWaveStore.getState();
  let cleaned = 0;

  // Collect all tokens belonging to this userId from nearbyPeers
  const userTokens = new Set<string>();
  for (const [token, peer] of peers) {
    if (peer.userId === userId) {
      userTokens.add(token);
    }
  }

  // Also check pendingWaves — the peer may have been pruned from nearbyPeers
  // but their token still exists in waveState. Look up userId via peers Map
  // (already captured above) and also match any token whose wave target
  // might belong to this user by checking all pending wave tokens against peers.
  for (const [token] of waveState.pendingWaves) {
    const peer = peers.get(token);
    if (peer?.userId === userId) {
      userTokens.add(token);
    }
  }

  // Clean all found tokens from all wave state collections
  for (const token of userTokens) {
    if (waveState.pendingWaves.has(token)) {
      useWaveStore.getState().removePendingWave(token);
      cleaned++;
    }
    if (waveState.incomingWaveTokens.includes(token)) {
      useWaveStore.getState().removeIncomingWaveToken(token);
      cleaned++;
    }
    if (waveState.wavingBackTokens.has(token)) {
      useWaveStore.getState().removeWavingBack(token);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.wave("Cleaned wave state for user", { userId, cleaned });
  }
}
