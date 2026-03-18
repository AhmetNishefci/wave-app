import { useEffect, useRef } from "react";
import { fetchNewToken, type TokenResponse } from "@/services/wave/ephemeralId";
import { waveBleManager } from "@/services/ble/bleManager";
import { useWaveStore } from "@/stores/waveStore";
import { useTokenStore } from "@/stores/tokenStore";
import { useMatchStore } from "@/stores/matchStore";
import { useAuthStore } from "@/stores/authStore";
import {
  EPHEMERAL_ROTATION_MS,
  EPHEMERAL_REFRESH_BUFFER_MS,
} from "@/services/ble/constants";
import { logger } from "@/utils/logger";

const MAX_CONSECUTIVE_FAILURES = 5;

/** Apply a token response to all relevant stores (O3 — caller-side store updates) */
function applyTokenResult(result: TokenResponse): void {
  const expiresAtMs = new Date(result.expires_at).getTime();
  useTokenStore.getState().setToken(result.token, expiresAtMs);

  if (result.gender) {
    useAuthStore.getState().setGender(result.gender);
  }
  useAuthStore.getState().setAge(result.age ?? null);
  useAuthStore.getState().setNote(result.note ?? null);
}

/**
 * Manages ephemeral token lifecycle: initial fetch and periodic rotation.
 * Rotates the token 3 minutes before expiry to ensure seamless coverage.
 */
export function useEphemeralRotation() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Guard: if the effect is cleaned up while an async operation is
    // still in-flight, the callback must become a no-op to prevent
    // orphaned timer chains that double server load on every toggle.
    let aborted = false;
    let consecutiveFailures = 0;

    const scheduleRotation = () => {
      if (aborted) return;

      let delay: number;
      if (consecutiveFailures > 0) {
        // Exponential backoff on failure: 30s, 60s, 120s, capped at 5 min
        delay = Math.min(30_000 * Math.pow(2, consecutiveFailures - 1), 5 * 60_000);
        logger.wave(`Token rotation backoff: retry in ${Math.round(delay / 1000)}s (failure #${consecutiveFailures})`);
      } else {
        const { tokenExpiresAt } = useTokenStore.getState();
        // Default to rotating in the standard interval if no expiry is set
        const baseDelay = tokenExpiresAt
          ? Math.max(1_000, tokenExpiresAt - Date.now() - EPHEMERAL_REFRESH_BUFFER_MS)
          : EPHEMERAL_ROTATION_MS - EPHEMERAL_REFRESH_BUFFER_MS;

        // Add ±30s jitter to prevent thundering herd when many users
        // rotate tokens at the same time (e.g. after a server restart)
        const jitter = (Math.random() - 0.5) * 60_000; // -30s to +30s
        delay = Math.max(1_000, baseDelay + jitter);
      }

      timerRef.current = setTimeout(async () => {
        if (aborted) return;

        logger.wave("Rotating ephemeral token...");
        useTokenStore.getState().setRotating(true);

        const result = await fetchNewToken();
        if (aborted) return;
        useTokenStore.getState().setRotating(false);

        if (result) {
          consecutiveFailures = 0;
          applyTokenResult(result);

          // Clear stale state AFTER new token is confirmed (C4 fix).
          // Previously these were cleared before fetch, causing state loss
          // on transient failures.
          useWaveStore.getState().clearAllPendingWaves();
          useWaveStore.getState().resetIncomingWaveTokens();
          useMatchStore.getState().clearMatchedTokens();

          await waveBleManager.rotateToken(result.token);
        } else {
          consecutiveFailures++;

          // If failures exceed threshold, warn — the device is advertising
          // an expired token (C5 fix)
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            logger.error(
              `Token rotation failed ${consecutiveFailures} consecutive times. ` +
              "Device may be advertising an expired token.",
            );
          }
        }

        // Schedule the next rotation based on the NEW token's expiry
        scheduleRotation();
      }, delay);
    };

    // Only fetch a new token if we don't have a valid one
    const { currentToken: existingToken, tokenExpiresAt } = useTokenStore.getState();
    const hasValidToken = existingToken && tokenExpiresAt && tokenExpiresAt > Date.now() + EPHEMERAL_REFRESH_BUFFER_MS;

    if (!hasValidToken) {
      useTokenStore.getState().setRotating(true);
      fetchNewToken().then((result) => {
        if (aborted) return;
        useTokenStore.getState().setRotating(false);
        if (result) {
          applyTokenResult(result);
          waveBleManager.rotateToken(result.token).catch((error) => {
            logger.error("Failed to update advertiser with initial token", error);
          });
        }
        // Schedule next rotation based on the fetched token's expiry
        scheduleRotation();
      });
    } else {
      // Token is valid — schedule rotation based on its actual expiry
      scheduleRotation();
    }

    return () => {
      aborted = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isAuthenticated]);
}
