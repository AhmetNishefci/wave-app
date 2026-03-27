import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/stores/authStore";
import { useMatchStore } from "@/stores/matchStore";
import { useBleStore } from "@/stores/bleStore";
import { logger } from "@/utils/logger";
import { clearWaveStateForUser } from "@/utils/waveCleanup";

// Lazy-load expo-notifications — may not be available in Expo Go
let Notifications: typeof import("expo-notifications") | null = null;
try {
  Notifications = require("expo-notifications");
} catch {
  logger.wave("expo-notifications not available, push disabled");
}

let registerForPushNotifications: (() => Promise<string | null>) | null = null;
try {
  registerForPushNotifications =
    require("@/services/notifications").registerForPushNotifications;
} catch {
  // notifications service depends on expo-notifications too
}

/**
 * Handles push notification registration and response (tap) handling.
 * Gracefully degrades when expo-notifications native module is unavailable.
 */
export function useNotifications() {
  const userId = useAuthStore((s) => s.userId);
  const router = useRouter();
  const responseListener = useRef<{ remove: () => void } | null>(null);

  // Register for push notifications when authenticated and app is in foreground.
  // iOS blocks Keychain access when the app is launched in the background with
  // the device locked, causing "User interaction is not allowed" errors.
  useEffect(() => {
    if (!userId || !registerForPushNotifications) return;

    if (AppState.currentState !== "active") {
      // App launched in background — defer registration until foregrounded
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          registerForPushNotifications!().catch((err) => {
            logger.error("Push registration failed", err);
          });
          sub.remove();
        }
      });
      return () => sub.remove();
    }

    registerForPushNotifications().catch((err) => {
      logger.error("Push registration failed", err);
    });
  }, [userId]);

  // Handle notification tap → navigate to match screen
  useEffect(() => {
    if (!Notifications) return;

    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data;
        logger.wave("Notification tapped", data);

        if (data?.type === "match" && data?.match_id) {
          // Add the match to the store. This sets latestUnseenMatch,
          // which MainLayout's useEffect detects and navigates to the
          // match screen. We do NOT call router.push here — that would
          // cause a double navigation (both this handler and MainLayout
          // would push /(main)/match, stacking two screens).
          const matchedUserId = (data.matched_user_id as string) ?? "unknown";
          const store = useMatchStore.getState();
          store.addMatch({
            matchId: data.match_id as string,
            matchedUserId,
            instagramHandle: (data.instagram_handle as string) ?? undefined,
            createdAt: (data.created_at as string) ?? new Date().toISOString(),
            seen: false,
          });
          if (matchedUserId !== "unknown") {
            clearWaveStateForUser(matchedUserId);
          }
        } else if (
          data?.type === "wave" ||
          data?.type === "proximity_alert" ||
          data?.type === "engagement"
        ) {
          useBleStore.getState().setProximityAlertPending(true);
          router.push("/(main)/radar");
        }
      });

    return () => {
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [router]);
}
