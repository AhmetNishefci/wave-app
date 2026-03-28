/**
 * Account identity linking — allows users to connect multiple sign-in
 * methods (Apple, Google, Phone) to a single account. Uses Supabase's
 * native identity linking API.
 *
 * Requires "Allow manual linking" enabled in Supabase Dashboard.
 */
import {
  GoogleSignin,
  isSuccessResponse,
  isErrorWithCode,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { logger } from "@/utils/logger";

// Lazy-load expo-apple-authentication
let AppleAuthentication: typeof import("expo-apple-authentication") | null = null;
try {
  AppleAuthentication = require("expo-apple-authentication");
} catch {
  // not available on Android/Expo Go
}

// --- Storage keys ---
const LAST_AUTH_PROVIDER_KEY = "wave_last_auth_provider";
const LINKED_PROVIDERS_KEY = "wave_linked_providers";

export type AuthProvider = "apple" | "google" | "phone";

// --- Provider memory (persists across sign-outs) ---

export async function getLastAuthProvider(): Promise<AuthProvider | null> {
  try {
    const value = await AsyncStorage.getItem(LAST_AUTH_PROVIDER_KEY);
    return value as AuthProvider | null;
  } catch {
    return null;
  }
}

export async function setLastAuthProvider(provider: AuthProvider): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_AUTH_PROVIDER_KEY, provider);
  } catch {
    // non-fatal
  }
}

export async function getLinkedProviderCache(): Promise<AuthProvider[]> {
  try {
    const value = await AsyncStorage.getItem(LINKED_PROVIDERS_KEY);
    return value ? JSON.parse(value) : [];
  } catch {
    return [];
  }
}

export async function setLinkedProviderCache(providers: AuthProvider[]): Promise<void> {
  try {
    await AsyncStorage.setItem(LINKED_PROVIDERS_KEY, JSON.stringify(providers));
  } catch {
    // non-fatal
  }
}

// --- Identity queries ---

export interface LinkedIdentity {
  id: string;
  provider: AuthProvider;
  email?: string;
  phone?: string;
}

/**
 * Fetch all identities linked to the current user from Supabase.
 * Updates the local provider cache.
 */
export async function getLinkedIdentities(): Promise<LinkedIdentity[]> {
  try {
    const { data, error } = await supabase.auth.getUserIdentities();
    if (error || !data?.identities) {
      logger.warn("Failed to fetch linked identities", error);
      return [];
    }

    const identities: LinkedIdentity[] = data.identities.map((identity: any) => ({
      id: identity.id,
      provider: mapProvider(identity.provider),
      email: identity.identity_data?.email,
      phone: identity.identity_data?.phone,
    }));

    // Update cache
    const providers = identities.map((i) => i.provider);
    await setLinkedProviderCache(providers);

    return identities;
  } catch (err) {
    logger.warn("Failed to fetch linked identities (exception)", err);
    return [];
  }
}

function mapProvider(provider: string): AuthProvider {
  if (provider === "apple") return "apple";
  if (provider === "google") return "google";
  if (provider === "phone") return "phone";
  return provider as AuthProvider;
}

// --- Linking ---

export interface LinkResult {
  success: boolean;
  error?: "cancelled" | "already_linked" | "identity_exists" | "unknown";
}

/**
 * Link a Google identity to the current user account.
 */
export async function linkGoogleIdentity(): Promise<LinkResult> {
  try {
    logger.auth("Linking Google identity...");

    await GoogleSignin.hasPlayServices();
    const response = await GoogleSignin.signIn();

    if (!isSuccessResponse(response)) {
      return { success: false, error: "cancelled" };
    }

    const idToken = response.data?.idToken;
    if (!idToken) {
      logger.warn("No ID token from Google Sign In during linking");
      return { success: false, error: "unknown" };
    }

    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      token: idToken,
    } as any);

    if (error) {
      logger.warn("Google identity linking failed", error.message);
      if (error.message?.includes("already linked")) {
        return { success: false, error: "already_linked" };
      }
      if (error.message?.includes("identity already exists")) {
        return { success: false, error: "identity_exists" };
      }
      return { success: false, error: "unknown" };
    }

    // Update cache
    const identities = await getLinkedIdentities();
    logger.auth("Google identity linked successfully", {
      totalIdentities: identities.length,
    });

    return { success: true };
  } catch (err: any) {
    if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) {
      return { success: false, error: "cancelled" };
    }
    logger.warn("Google linking error", err);
    return { success: false, error: "unknown" };
  }
}

/**
 * Link an Apple identity to the current user account.
 */
export async function linkAppleIdentity(): Promise<LinkResult> {
  try {
    if (!AppleAuthentication) {
      return { success: false, error: "unknown" };
    }

    logger.auth("Linking Apple identity...");

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    const identityToken = credential.identityToken;
    if (!identityToken) {
      logger.warn("No identity token from Apple during linking");
      return { success: false, error: "unknown" };
    }

    const { error } = await supabase.auth.linkIdentity({
      provider: "apple",
      token: identityToken,
    } as any);

    if (error) {
      logger.warn("Apple identity linking failed", error.message);
      if (error.message?.includes("already linked")) {
        return { success: false, error: "already_linked" };
      }
      if (error.message?.includes("identity already exists")) {
        return { success: false, error: "identity_exists" };
      }
      return { success: false, error: "unknown" };
    }

    const identities = await getLinkedIdentities();
    logger.auth("Apple identity linked successfully", {
      totalIdentities: identities.length,
    });

    return { success: true };
  } catch (err: any) {
    if (err?.code === "ERR_REQUEST_CANCELED") {
      return { success: false, error: "cancelled" };
    }
    const isTransient = err?.message?.includes("unknown reason");
    if (isTransient) {
      logger.warn("Apple linking failed (transient)", err?.message);
    } else {
      logger.warn("Apple linking error", err);
    }
    return { success: false, error: "unknown" };
  }
}

/**
 * Link a phone identity. Step 1: send OTP.
 */
export async function sendPhoneLinkOtp(phone: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    // Use updateUser to add a phone number to the current account.
    // This sends an OTP to the phone. Verify with type: "phone_change".
    // Do NOT use signInWithOtp — that creates a new session instead of linking.
    const { error } = await supabase.auth.updateUser({
      phone,
    });

    if (error) {
      logger.warn("Phone link OTP send failed", error.message);
      if (error.message?.includes("rate") || error.status === 429) {
        return { success: false, error: "rate_limited" };
      }
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    logger.warn("Phone link OTP exception", err);
    return { success: false, error: "unknown" };
  }
}

/**
 * Link a phone identity. Step 2: verify OTP and link.
 */
export async function verifyPhoneLinkOtp(
  phone: string,
  code: string,
): Promise<LinkResult> {
  try {
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token: code,
      type: "phone_change",
    });

    if (error) {
      logger.warn("Phone link OTP verify failed", error.message);
      return { success: false, error: "unknown" };
    }

    const identities = await getLinkedIdentities();
    logger.auth("Phone identity linked successfully", {
      totalIdentities: identities.length,
    });

    return { success: true };
  } catch (err) {
    logger.warn("Phone link verify exception", err);
    return { success: false, error: "unknown" };
  }
}

/**
 * Unlink an identity from the current user.
 * Fails if only 1 identity remains (Supabase enforces this).
 */
export async function unlinkIdentity(identityId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const { data, error: idError } = await supabase.auth.getUserIdentities();
    if (idError || !data?.identities) {
      return { success: false, error: "Failed to fetch identities" };
    }

    const identity = data.identities.find((i: any) => i.id === identityId);
    if (!identity) {
      return { success: false, error: "Identity not found" };
    }

    if (data.identities.length <= 1) {
      return { success: false, error: "Cannot unlink last sign-in method" };
    }

    const { error } = await supabase.auth.unlinkIdentity(identity as any);
    if (error) {
      logger.warn("Unlink identity failed", error.message);
      return { success: false, error: error.message };
    }

    // Update cache
    await getLinkedIdentities();
    logger.auth("Identity unlinked successfully", {
      provider: identity.provider,
    });

    return { success: true };
  } catch (err) {
    logger.warn("Unlink identity exception", err);
    return { success: false, error: "unknown" };
  }
}
