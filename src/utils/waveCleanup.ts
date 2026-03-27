/**
 * Shared utility to clean wave state (pendingWaves + incomingWaveTokens)
 * for a specific user. Called whenever a match is created or removed to
 * prevent stale "Undo" or "Wave back" badges from resurfacing.
 *
 * Works by finding all BLE tokens belonging to the given userId in
 * nearbyPeers and removing them from waveStore.
 */
import { useBleStore } from "@/stores/bleStore";
import { useWaveStore } from "@/stores/waveStore";
import { logger } from "@/utils/logger";

export function clearWaveStateForUser(userId: string): void {
  const peers = useBleStore.getState().nearbyPeers;
  const waveState = useWaveStore.getState();
  let cleaned = 0;

  for (const [token, peer] of peers) {
    if (peer.userId === userId) {
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
  }

  if (cleaned > 0) {
    logger.wave("Cleaned wave state for user", { userId, cleaned });
  }
}
