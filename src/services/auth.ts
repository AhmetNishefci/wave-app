import {
  GoogleSignin,
  isSuccessResponse,
  isErrorWithCode,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import { supabase } from "./supabase";
import i18n from "@/i18n";
import { useAuthStore } from "@/stores/authStore";
import { useWaveStore } from "@/stores/waveStore";
import { useTokenStore } from "@/stores/tokenStore";
import { useMatchStore } from "@/stores/matchStore";
import { useBleStore } from "@/stores/bleStore";
import { waveBleManager } from "@/services/ble/bleManager";
import { unsubscribeFromMatches } from "@/services/wave/realtime";
import { clearOfflineQueue } from "@/services/wave/waves";
import { resetTimezoneSyncCache } from "@/services/profile";
import { resetLocationCache } from "@/services/location";
import { logger } from "@/utils/logger";
import { setLastAuthProvider, addKnownProvider, getLinkedIdentities } from "@/services/authLinking";

// Lazy-load to match the pattern in useNotifications (may not be available in Expo Go)
let unregisterPushToken: (() => Promise<void>) | null = null;
try {
  unregisterPushToken =
    require("@/services/notifications").unregisterPushToken;
} catch {
  // notifications service depends on expo-notifications native module
}

// Lazy-load expo-apple-authentication — may not be available on Android/Expo Go
let AppleAuthentication: typeof import("expo-apple-authentication") | null = null;
try {
  AppleAuthentication = require("expo-apple-authentication");
} catch {
  logger.auth("expo-apple-authentication not available");
}

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";

// Configure Google Sign In
GoogleSignin.configure({
  webClientId: WEB_CLIENT_ID,
  iosClientId: IOS_CLIENT_ID,
});

/**
 * Sign in with Google using the native dialog.
 * Gets a Google ID token, then exchanges it for a Supabase session.
 */
export async function signInWithGoogle(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    logger.auth("Starting Google Sign In");

    const response = await GoogleSignin.signIn();

    if (!isSuccessResponse(response)) {
      logger.auth("Google Sign In cancelled");
      return { success: false, error: "cancelled" };
    }

    const idToken = response.data.idToken;
    if (!idToken) {
      logger.error("No ID token from Google Sign In");
      return { success: false, error: i18n.t("auth.noIdToken") };
    }

    logger.auth("Google ID token received, signing in with Supabase...");

    const { error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });

    if (error) {
      logger.error("Supabase signInWithIdToken failed", error);
      return { success: false, error: error.message };
    }

    logger.auth("Google Sign In complete");
    setLastAuthProvider("google").catch(() => {});
    addKnownProvider("google").catch(() => {});
    getLinkedIdentities().catch(() => {});
    return { success: true };
  } catch (err: unknown) {
    if (isErrorWithCode(err)) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED) {
        return { success: false, error: "cancelled" };
      }
      if (err.code === statusCodes.IN_PROGRESS) {
        return { success: false, error: i18n.t("auth.signInProgress") };
      }
    }
    logger.error("Google sign-in error", err);
    return { success: false, error: i18n.t("common.somethingWentWrong") };
  }
}

/**
 * Sign in with Apple using the native iOS dialog.
 * Gets an Apple identity token, then exchanges it for a Supabase session.
 */
export async function signInWithApple(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    logger.auth("Starting Apple Sign In");

    if (!AppleAuthentication) {
      return { success: false, error: i18n.t("auth.appleNotAvailable") };
    }

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    const identityToken = credential.identityToken;
    if (!identityToken) {
      logger.error("No identity token from Apple Sign In");
      return { success: false, error: i18n.t("auth.noIdentityToken") };
    }

    logger.auth("Apple identity token received, signing in with Supabase...");

    const { error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: identityToken,
    });

    if (error) {
      logger.error("Supabase signInWithIdToken (Apple) failed", error);
      return { success: false, error: error.message };
    }

    logger.auth("Apple Sign In complete");
    setLastAuthProvider("apple").catch(() => {});
    addKnownProvider("apple").catch(() => {});
    getLinkedIdentities().catch(() => {});
    return { success: true };
  } catch (err: any) {
    if (err?.code === "ERR_REQUEST_CANCELED") {
      return { success: false, error: "cancelled" };
    }
    // Apple's "unknown reason" error is transient (iCloud issues, device
    // restrictions, overheating, network during Apple ID verification).
    // User sees error toast and can retry — not actionable for engineers.
    const isTransient = err?.message?.includes("unknown reason") || err?.message?.includes("User interaction is not allowed") || err?.code === "ERR_APPLE_AUTHENTICATION_UNKNOWN";
    if (isTransient) {
      logger.warn("Apple sign-in failed (transient)", err?.message);
    } else {
      logger.error("Apple sign-in error", err);
    }
    return { success: false, error: i18n.t("common.somethingWentWrong") };
  }
}

/**
 * Send an OTP code to a phone number via SMS.
 * Requires Twilio to be configured in Supabase dashboard.
 * Phone must be in E.164 format (e.g., "+15551234567").
 */
export async function sendPhoneOtp(phone: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    logger.auth("Sending phone OTP", { phone: phone.substring(0, 6) + "..." });

    const { error } = await supabase.auth.signInWithOtp({ phone });

    if (error) {
      logger.error("Phone OTP send failed", error);

      if (error.message?.includes("rate") || error.status === 429) {
        return { success: false, error: i18n.t("auth.rateLimited") };
      }

      return { success: false, error: error.message };
    }

    logger.auth("Phone OTP sent");
    return { success: true };
  } catch (err) {
    logger.error("Phone OTP exception", err);
    return { success: false, error: i18n.t("common.somethingWentWrong") };
  }
}

/**
 * Verify a phone OTP code and create a Supabase session.
 * Phone must match the one used in sendPhoneOtp.
 */
export async function verifyPhoneOtp(
  phone: string,
  code: string,
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    logger.auth("Verifying phone OTP");

    const { error } = await supabase.auth.verifyOtp({
      phone,
      token: code,
      type: "sms",
    });

    if (error) {
      logger.error("Phone OTP verification failed", error);

      if (error.message?.includes("expired")) {
        return { success: false, error: i18n.t("auth.codeExpired") };
      }
      if (error.message?.includes("invalid") || error.message?.includes("Invalid")) {
        return { success: false, error: i18n.t("auth.invalidCode") };
      }

      return { success: false, error: error.message };
    }

    logger.auth("Phone sign-in complete");
    setLastAuthProvider("phone").catch(() => {});
    addKnownProvider("phone").catch(() => {});
    getLinkedIdentities().catch(() => {});
    return { success: true };
  } catch (err) {
    logger.error("Phone OTP verify exception", err);
    return { success: false, error: i18n.t("common.somethingWentWrong") };
  }
}

/**
 * Sign out of the current session.
 * Stops BLE, clears Google session, Supabase session, realtime
 * subscriptions, and all local stores.
 *
 * Stores are reset BEFORE supabase.auth.signOut() because signOut
 * triggers onAuthStateChange synchronously, which navigates to login.
 * Stores must be clean before that navigation happens (L2 fix).
 */
export async function signOut(): Promise<void> {
  try {
    // Stop BLE engine (LP3 fix — idempotent if not running)
    try {
      await waveBleManager.stop();
    } catch {
      // Ignore — may not be initialized
    }

    try {
      await GoogleSignin.signOut();
    } catch {
      // Ignore — user may not have signed in via Google
    }

    // Unsubscribe from realtime before signing out (H12 fix)
    unsubscribeFromMatches();

    // Remove push token from server so old account stops receiving notifications
    try {
      if (unregisterPushToken) await unregisterPushToken();
    } catch {
      // Non-fatal — token will be overwritten on next sign-in
    }

    // Clear offline wave queue to prevent stale waves leaking to new session
    clearOfflineQueue();

    // Reset module-level caches (LP2 fix)
    resetTimezoneSyncCache();
    resetLocationCache();

    // Reset ALL stores BEFORE signOut so navigation triggered by
    // onAuthStateChange sees clean state (L2 fix)
    useWaveStore.getState().reset();
    useTokenStore.getState().reset();
    useMatchStore.getState().reset();
    useBleStore.getState().reset();
    useAuthStore.getState().reset();

    await supabase.auth.signOut();

    logger.auth("Signed out");
  } catch (err) {
    logger.error("Sign out error", err);
    // Re-throw so callers know sign-out failed (M5 fix)
    throw err;
  }
}
