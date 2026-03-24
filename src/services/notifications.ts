import { Platform } from "react-native";
import Constants from "expo-constants";
import { supabase } from "./supabase";
import { logger } from "@/utils/logger";

// Lazy-load native modules — may not be available in Expo Go
let Notifications: typeof import("expo-notifications") | null = null;
let Device: typeof import("expo-device") | null = null;

try {
  Notifications = require("expo-notifications");
} catch {
  logger.wave("expo-notifications not available");
}

try {
  Device = require("expo-device");
} catch {
  logger.wave("expo-device not available");
}

/**
 * Configure notification handler (how notifications appear when app is foregrounded)
 */
try {
  Notifications?.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch {
  // ignore if native module missing
}

/**
 * Request notification permissions and register push token with Supabase.
 * Returns the Expo push token or null if unavailable.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Notifications || !Device) {
    logger.wave("Push notifications not available (native modules missing)");
    return null;
  }

  // Push notifications only work on physical devices
  if (!Device.isDevice) {
    logger.wave("Push notifications require a physical device");
    return null;
  }

  // Check / request permissions
  const { status: existingStatus } =
    await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    logger.wave("Push notification permission not granted");
    return null;
  }

  // Retry logic — on first install the APS entitlement may not be ready yet
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000; // ms

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Get the Expo Push Token (wraps APNs/FCM, used with Expo Push API)
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: Constants.expoConfig?.extra?.eas?.projectId,
      });
      const pushToken = tokenData.data; // Format: ExponentPushToken[xxx]
      const platform = Platform.OS; // 'ios' or 'android'

      logger.wave("Got device push token", {
        token: pushToken.substring(0, 12) + "...",
        platform,
      });

      // Upsert to Supabase
      const { error } = await supabase
        .from("push_tokens")
        .upsert(
          {
            user_id: (await supabase.auth.getUser()).data.user?.id,
            token: pushToken,
            platform,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,platform" },
        );

      if (error) {
        logger.error("Failed to save push token to Supabase", error);
      } else {
        logger.wave("Push token registered with Supabase");
      }

      return pushToken;
    } catch (err: any) {
      const msg = err?.message ?? "";
      const isRetryable = msg.includes("aps-environment") || msg.includes("503") || msg.includes("SERVICE_UNAVAILABLE") || msg.includes("isTransient");
      if (isRetryable && attempt < MAX_RETRIES) {
        logger.wave(`Push token attempt ${attempt} failed (transient), retrying in ${RETRY_DELAY}ms...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
        continue;
      }
      // Transient failures after all retries — warn, don't send to Sentry
      if (isRetryable) {
        logger.warn("Push token registration failed (transient, all retries exhausted)", msg);
      } else {
        logger.error("Failed to get push token", err);
      }
      return null;
    }
  }
  return null;
}

/**
 * Remove push token from Supabase (e.g. on logout)
 */
export async function unregisterPushToken(): Promise<void> {
  try {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) return;

    await supabase
      .from("push_tokens")
      .delete()
      .eq("user_id", userId)
      .eq("platform", Platform.OS);

    logger.wave("Push token unregistered");
  } catch (err) {
    logger.error("Failed to unregister push token", err);
  }
}
