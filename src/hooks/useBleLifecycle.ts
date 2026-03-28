import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { waveBleManager } from "@/services/ble/bleManager";
import { useBleStore } from "@/stores/bleStore";
import { useWaveStore } from "@/stores/waveStore";
import { useTokenStore } from "@/stores/tokenStore";
import { useAuthStore } from "@/stores/authStore";
import { fetchNewToken } from "@/services/wave/ephemeralId";
import { fetchMatchesFromServer } from "@/services/wave/matches";
import { unsubscribeFromMatches, subscribeToMatches } from "@/services/wave/realtime";
import { getCurrentLocation, updateLocationOnServer } from "@/services/location";
import { logger } from "@/utils/logger";

const WAVE_EXPIRY_MS = 15 * 60_000; // 15 minutes — matches server-side wave lifetime

/**
 * Manages BLE lifecycle with app state transitions.
 *
 * Background behavior (iOS):
 * - BLE scanning and advertising continue running in background.
 * - iOS automatically throttles scan frequency when backgrounded.
 * - The local name is stripped from ads; scanners use GATT reads instead.
 * - On return to foreground, we restart the scan cycle at full speed.
 */
export function useBleLifecycle() {
  const wasRunning = useRef(false);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      // Read BLE state directly from the store to avoid stale closures
      const { isScanning, isAdvertising } = useBleStore.getState();

      if (nextAppState === "background" || nextAppState === "inactive") {
        // Track that BLE was active so we can refresh on foreground return
        if (isScanning || isAdvertising) {
          wasRunning.current = true;
          logger.ble("App backgrounded — BLE continues running (iOS managed)");
        }
      } else if (nextAppState === "active") {
        // Restart scan cycle at full speed when returning to foreground
        if (wasRunning.current) {
          wasRunning.current = false;

          // Check if ephemeral token expired while backgrounded
          const { tokenExpiresAt } = useTokenStore.getState();
          if (!tokenExpiresAt || tokenExpiresAt < Date.now()) {
            logger.wave("Token expired during background — fetching new one before restarting scan");
            fetchNewToken().then((result) => {
              if (result) {
                // Apply token to stores (O3 — caller-side updates)
                const expiresAtMs = new Date(result.expires_at).getTime();
                useTokenStore.getState().setToken(result.token, expiresAtMs);
                waveBleManager.rotateToken(result.token).catch((e) =>
                  logger.error("Failed to rotate token on foreground", e),
                );
              }
              waveBleManager.restartScanCycle();
              logger.ble("App foregrounded — scan cycle restarted after token refresh");
            });
          } else {
            waveBleManager.restartScanCycle();
            logger.ble("App foregrounded — scan cycle restarted at full speed");
          }

          // Reconcile pending waves: expire stale ones (>15 min) and fetch
          // matches from server to catch any created during network drops
          const { pendingWaves } = useWaveStore.getState();
          if (pendingWaves.size > 0) {
            const now = Date.now();
            for (const [token, wave] of pendingWaves) {
              if (now - wave.sentAt > WAVE_EXPIRY_MS) {
                useWaveStore.getState().removePendingWave(token);
                logger.wave("Expired stale pending wave on foreground", {
                  token: token.substring(0, 8),
                });
              }
            }
          }
          // Fetch server matches to catch any created while backgrounded or
          // during network failures (wave sent → network drop → match created)
          fetchMatchesFromServer().catch((e) =>
            logger.warn("Match reconciliation on foreground failed (non-fatal)", e),
          );

          // Force Realtime reconnection. After long background (iOS suspends
          // the app), the WebSocket dies silently — no CLOSED/ERROR event fires.
          // The Supabase client thinks the channel is still SUBSCRIBED but the
          // TCP connection is dead. Re-subscribing ensures wave/match/undo
          // broadcasts arrive immediately after foreground.
          const userId = useAuthStore.getState().userId;
          if (userId) {
            unsubscribeFromMatches();
            subscribeToMatches(userId);
            logger.wave("Realtime re-subscribed on foreground");
          }

          // Force useNoteResolver to re-query all peers on the next tick.
          // This catches wave state changes (undo, block, etc.) that happened
          // while backgrounded and were missed because the Realtime socket died.
          useBleStore.getState().bumpResolveGeneration();

          // Refresh location so proximity alerts stay fresh while backgrounded
          // Server rate-limits to 30s, so this is safe to call on every foreground.
          if (useAuthStore.getState().nearbyAlertsEnabled) {
            getCurrentLocation().then((loc) => {
              if (loc) {
                updateLocationOnServer(loc.latitude, loc.longitude).catch((e) =>
                  logger.warn("Location refresh on foreground failed (non-fatal)", e),
                );
              }
            });
          }
        }
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );

    // Reconnect Realtime when network connectivity changes (e.g., WiFi → cellular
    // on a walk to a coffee bar). The WebSocket can die silently when the
    // underlying transport changes — no CLOSED/ERROR event fires. This listener
    // forces a fresh subscription whenever the device regains connectivity.
    let wasConnected = true;
    const netUnsubscribe = NetInfo.addEventListener((state) => {
      const isConnected = !!state.isConnected;
      if (isConnected && !wasConnected) {
        // Network restored — force Realtime reconnection
        const userId = useAuthStore.getState().userId;
        if (userId) {
          unsubscribeFromMatches();
          subscribeToMatches(userId);
          useBleStore.getState().bumpResolveGeneration();
          logger.wave("Realtime re-subscribed on network restore");
        }
      }
      wasConnected = isConnected;
    });

    return () => {
      subscription.remove();
      netUnsubscribe();
    };
  }, []); // Empty deps — reads from store inside callback
}
