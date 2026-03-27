import * as Location from "expo-location";
import { invokeWithTimeout } from "./supabase";
import { logger } from "@/utils/logger";

/** Timestamp (ms) when the rate limit window expires. Prevents wasteful calls. */
let rateLimitedUntil = 0;

/** Reset module-level caches. Called on sign-out to prevent cross-session leakage. */
export function resetLocationCache(): void {
  rateLimitedUntil = 0;
}

export type LocationPermissionResult = "granted" | "denied" | "blocked";

/**
 * Request "When In Use" location permission.
 * Returns:
 * - "granted" — permission granted
 * - "denied" — user dismissed or denied (can ask again)
 * - "blocked" — permanently denied, must open Settings to change
 */
export async function requestLocationPermission(): Promise<LocationPermissionResult> {
  try {
    const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
    logger.auth("Location permission", { status, canAskAgain });

    if (status === "granted") return "granted";
    if (!canAskAgain) return "blocked";
    return "denied";
  } catch (err) {
    logger.error("Location permission request failed", err);
    return "denied";
  }
}

/**
 * Check if location permission is currently granted.
 */
export async function hasLocationPermission(): Promise<boolean> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

/**
 * Check if location permission is permanently blocked (denied + can't ask again).
 */
export async function isLocationBlocked(): Promise<boolean> {
  try {
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    return status !== "granted" && !canAskAgain;
  } catch {
    return false;
  }
}

/**
 * Get the user's current position.
 * Uses balanced accuracy (good precision, reasonable battery usage).
 * Returns null if unavailable.
 */
export async function getCurrentLocation(): Promise<{
  latitude: number;
  longitude: number;
} | null> {
  try {
    const hasPermission = await hasLocationPermission();
    if (!hasPermission) {
      logger.wave("Location permission not granted, skipping");
      return null;
    }

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
  } catch (err) {
    logger.error("Failed to get current location", err);
    return null;
  }
}

/**
 * Send the user's location to the server and trigger proximity notifications.
 * Called when the user starts BLE discovery.
 * Non-blocking — failures are logged but don't affect BLE discovery.
 */
export async function updateLocationOnServer(
  latitude: number,
  longitude: number,
): Promise<{ nearbyCount: number; notifiedCount: number } | null> {
  try {
    // Skip if still within the server's rate limit window
    if (Date.now() < rateLimitedUntil) {
      logger.wave("Skipping location update — rate limited");
      return null;
    }

    const { data, error } = await invokeWithTimeout(
      "update-location",
      { body: { latitude, longitude } },
    );

    if (error) {
      // Extract response body for debugging (FunctionsHttpError has context.json())
      let detail: unknown = error.message;
      try {
        if ("context" in error && typeof error.context?.json === "function") {
          detail = await error.context.json();
        }
      } catch { /* ignore parse errors */ }

      // Rate limiting is expected, not an error — respect the server's backoff
      const retryAfter = (detail as any)?.retry_after_ms;
      if ((detail as any)?.error === "Rate limited" && typeof retryAfter === "number") {
        rateLimitedUntil = Date.now() + retryAfter;
        logger.wave("Location update rate limited", { retryAfterMs: retryAfter });
        return null;
      }

      logger.error("updateLocationOnServer error", { message: error.message, detail });
      return null;
    }

    const result = data as {
      status: string;
      nearby_count: number;
      notified_count: number;
    };

    logger.wave("Location updated", {
      nearbyCount: result.nearby_count,
      notifiedCount: result.notified_count,
    });

    return {
      nearbyCount: result.nearby_count,
      notifiedCount: result.notified_count,
    };
  } catch (err) {
    logger.error("updateLocationOnServer exception", err);
    return null;
  }
}
