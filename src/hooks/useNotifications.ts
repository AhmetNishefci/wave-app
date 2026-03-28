import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/stores/authStore";
import { useMatchStore } from "@/stores/matchStore";
import { useWaveStore } from "@/stores/waveStore";
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
            logger.warn("Push registration failed (non-fatal)", err);
          });
          sub.remove();
        }
      });
      return () => sub.remove();
    }

    registerForPushNotifications().catch((err) => {
      logger.warn("Push registration failed (non-fatal)", err);
    });
  }, [userId]);

  // Handle foreground notification delivery — processes match/wave pushes
  // silently without waiting for the user to tap. This is the critical
  // fallback when the Realtime broadcast is missed (WebSocket glitch,
  // momentary disconnect). Without this, the user only learns about a
  // match by tapping the notification banner — which iOS doesn't even
  // show when the app is in foreground.
  const receivedListener = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    if (!Notifications) return;

    receivedListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        const data = notification.request.content.data;
        logger.wave("Foreground notification received", data);

        if (data?.type === "match" && data?.match_id) {
          const matchedUserId = (data.matched_user_id as string) ?? "unknown";
          const store = useMatchStore.getState();
          // Only add if not already in store (Realtime may have delivered it first)
          if (!store.matchesById.has(data.match_id as string)) {
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
            logger.wave("Match added from foreground push (Realtime fallback)");
          }
        } else if (data?.type === "wave" && data?.waver_token) {
          // Fallback for when Realtime broadcast was missed (WebSocket died
          // silently during extended foreground usage or network change).
          const waveStore = useWaveStore.getState();
          const token = data.waver_token as string;
          if (!waveStore.incomingWaveTokens.includes(token)) {
            waveStore.addIncomingWaveToken(token);
            logger.wave("Incoming wave added from foreground push (Realtime fallback)");
          }
        }
      });

    return () => {
      if (receivedListener.current) {
        receivedListener.current.remove();
      }
    };
  }, []);

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
        } else if (data?.type === "wave") {
          // Navigate to radar — do NOT add waver_token here. The token will
          // be added by useNoteResolver's first tick (~1-3s) after checking
          // has_waved_at_me from the server. Adding it eagerly here causes a
          // race condition: if A undoes before B's Realtime connects, the
          // wave_undo broadcast fires before the token is added (no-op), then
          // the tap handler adds it afterwards — creating a stale "Wave back".
          router.push("/(main)/radar");
        } else if (
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
