import { supabase } from "./supabase";
import { logger } from "@/utils/logger";
import { getLocales } from "expo-localization";
import type { Gender, GenderPreference } from "@/types";

/**
 * No-op retained for backward compatibility — callers (auth.ts signOut)
 * still reference it. Timezone is now synced on every app open (no throttle).
 */
export function resetTimezoneSyncCache(): void {
  // No-op — timezone sync is no longer throttled
}

/**
 * Sync the user's locale to the server immediately.
 * Called when the user manually changes language in Settings.
 */
export async function syncLocaleToServer(locale: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("profiles").update({ locale }).eq("id", user.id);
    logger.auth("Locale synced to server", { locale });
  } catch (err) {
    logger.error("Locale sync failed (non-fatal)", err);
  }
}

export interface UserProfile {
  dateOfBirth: string | null;
  instagramHandle: string | null;
  snapchatHandle: string | null;
  gender: Gender | null;
  genderPreference: GenderPreference | null;
  agePreferenceMin: number | null;
  agePreferenceMax: number | null;
  note: string | null;
  nearbyAlertsEnabled: boolean;
  nearbyAlertsOnboarded: boolean;
  dailyPushesEnabled: boolean;
}

/**
 * Fetch the current user's profile (gender, preference, Instagram handle).
 */
export async function fetchProfile(): Promise<UserProfile | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      logger.error("fetchProfile: no user");
      return null;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("date_of_birth, instagram_handle, snapchat_handle, gender, gender_preference, age_preference_min, age_preference_max, note, nearby_alerts_enabled, nearby_alerts_onboarded, daily_pushes_enabled")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      logger.error("fetchProfile error", error);
      return null;
    }

    return {
      dateOfBirth: data?.date_of_birth ?? null,
      instagramHandle: data?.instagram_handle ?? null,
      snapchatHandle: data?.snapchat_handle ?? null,
      gender: data?.gender ?? null,
      genderPreference: data?.gender_preference ?? null,
      agePreferenceMin: data?.age_preference_min ?? null,
      agePreferenceMax: data?.age_preference_max ?? null,
      note: data?.note ?? null,
      nearbyAlertsEnabled: data?.nearby_alerts_enabled ?? true,
      nearbyAlertsOnboarded: data?.nearby_alerts_onboarded ?? false,
      dailyPushesEnabled: data?.daily_pushes_enabled ?? true,
    };
  } catch (err) {
    logger.error("fetchProfile exception", err);
    return null;
  }
}

/**
 * Fetch the current user's Instagram handle from their profile.
 * Returns null if not set.
 */
export async function fetchInstagramHandle(): Promise<string | null> {
  const profile = await fetchProfile();
  return profile?.instagramHandle ?? null;
}

/**
 * Save the user's date of birth (set once, immutable via DB trigger).
 * Expects YYYY-MM-DD format.
 */
export async function saveDateOfBirth(dob: string): Promise<boolean> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      logger.error("saveDateOfBirth: no user");
      return false;
    }

    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ date_of_birth: dob })
      .eq("id", user.id)
      .select("id");

    if (error) {
      logger.error("saveDateOfBirth error", error);
      return false;
    }

    if (!updated || updated.length === 0) {
      logger.error("saveDateOfBirth: no profile row — attempting upsert fallback", { userId: user.id });
      const { error: upsertError } = await supabase
        .from("profiles")
        .upsert(
          { id: user.id, date_of_birth: dob },
          { onConflict: "id" },
        );

      if (upsertError) {
        logger.error("saveDateOfBirth upsert fallback failed", upsertError);
        return false;
      }
    }

    logger.auth("Date of birth saved", { dob });
    return true;
  } catch (err) {
    logger.error("saveDateOfBirth exception", err);
    return false;
  }
}

/**
 * Save gender, gender preference, and age preference to the user's profile.
 * Called during onboarding (gender is set once and locked).
 */
export async function saveGenderProfile(
  gender: Gender,
  genderPreference: GenderPreference,
  agePreferenceMin?: number,
  agePreferenceMax?: number,
): Promise<boolean> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      logger.error("saveGenderProfile: no user");
      return false;
    }

    const updates: Record<string, unknown> = {
      gender,
      gender_preference: genderPreference,
    };
    if (agePreferenceMin !== undefined) updates.age_preference_min = agePreferenceMin;
    if (agePreferenceMax !== undefined) updates.age_preference_max = agePreferenceMax;

    const { data: updated, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select("id");

    if (error) {
      logger.error("saveGenderProfile error", error);
      return false;
    }

    // If no row was updated, the auth trigger may not have fired yet.
    // Fall back to an upsert to create the profile row.
    if (!updated || updated.length === 0) {
      logger.error("saveGenderProfile: no profile row — attempting upsert fallback", { userId: user.id });
      const { error: upsertError } = await supabase
        .from("profiles")
        .upsert(
          { id: user.id, ...updates },
          { onConflict: "id" },
        );

      if (upsertError) {
        logger.error("saveGenderProfile upsert fallback failed", upsertError);
        return false;
      }
    }

    logger.auth("Gender profile saved", { gender, genderPreference, agePreferenceMin, agePreferenceMax });
    return true;
  } catch (err) {
    logger.error("saveGenderProfile exception", err);
    return false;
  }
}

/**
 * Update the user's gender preference (changeable from settings).
 */
export async function updateGenderPreference(
  genderPreference: GenderPreference,
): Promise<boolean> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      logger.error("updateGenderPreference: no user");
      return false;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ gender_preference: genderPreference })
      .eq("id", user.id);

    if (error) {
      logger.error("updateGenderPreference error", error);
      return false;
    }

    logger.auth("Gender preference updated", { genderPreference });
    return true;
  } catch (err) {
    logger.error("updateGenderPreference exception", err);
    return false;
  }
}

/**
 * Update the user's age preference range (changeable from settings).
 */
export async function updateAgePreference(
  min: number,
  max: number,
): Promise<boolean> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      logger.error("updateAgePreference: no user");
      return false;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ age_preference_min: min, age_preference_max: max })
      .eq("id", user.id);

    if (error) {
      logger.error("updateAgePreference error", error);
      return false;
    }

    logger.auth("Age preference updated", { min, max });
    return true;
  } catch (err) {
    logger.error("updateAgePreference exception", err);
    return false;
  }
}

export interface HandleSaveResult {
  handle: string | null;
  error?: "invalid" | "taken";
}

/**
 * Save/update the user's Instagram handle.
 * Strips leading @ if present, lowercases, and validates.
 * Returns { handle } on success, { handle: null, error } on failure.
 * The `error` field distinguishes "invalid format" from "already taken".
 */
export async function saveInstagramHandle(
  rawHandle: string,
): Promise<HandleSaveResult> {
  try {
    // Clean the handle
    let handle = rawHandle.trim().toLowerCase();
    if (handle.startsWith("@")) {
      handle = handle.substring(1);
    }

    // Validate: Instagram usernames are 1-30 chars, alphanumeric + dots + underscores.
    // Must start and end with alphanumeric, no consecutive dots (M2 fix).
    const igRegex = /^[a-z0-9](?:[a-z0-9._]{0,28}[a-z0-9])?$/;
    if (!igRegex.test(handle) || handle.includes("..")) {
      logger.error("saveInstagramHandle: invalid format", { handle });
      return { handle: null, error: "invalid" };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      logger.error("saveInstagramHandle: no user");
      return { handle: null };
    }

    // Use the claim_instagram_handle RPC which atomically releases the
    // handle from any orphaned anonymous profile before assigning it.
    const { error } = await supabase.rpc("claim_instagram_handle", {
      p_handle: handle,
    });

    if (error) {
      // PostgreSQL 23505 = unique constraint violation on instagram_handle index.
      // This means another (non-anonymous) user already has this handle.
      if (error.code === "23505") {
        logger.error("saveInstagramHandle: handle already taken", { handle });
        return { handle: null, error: "taken" };
      }
      logger.error("saveInstagramHandle error", error);
      return { handle: null };
    }

    logger.auth("Instagram handle saved", { handle });
    return { handle };
  } catch (err) {
    logger.error("saveInstagramHandle exception", err);
    return { handle: null };
  }
}

/**
 * Save/update the user's Snapchat handle.
 * Strips leading @, lowercases, and validates.
 * Returns { handle } on success, { handle: null, error } on failure.
 */
export async function saveSnapchatHandle(
  rawHandle: string,
): Promise<HandleSaveResult> {
  try {
    let handle = rawHandle.trim().toLowerCase();
    if (handle.startsWith("@")) {
      handle = handle.substring(1);
    }

    // Snapchat usernames: 3-15 chars, start with letter, alphanumeric + dots/underscores/hyphens,
    // end with letter or number.
    const scRegex = /^[a-z][a-z0-9._-]{1,13}[a-z0-9]$/;
    if (!scRegex.test(handle)) {
      logger.error("saveSnapchatHandle: invalid format", { handle });
      return { handle: null, error: "invalid" };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      logger.error("saveSnapchatHandle: no user");
      return { handle: null };
    }

    const { error } = await supabase.rpc("claim_snapchat_handle", {
      p_handle: handle,
    });

    if (error) {
      if (error.code === "23505") {
        logger.error("saveSnapchatHandle: handle already taken", { handle });
        return { handle: null, error: "taken" };
      }
      logger.error("saveSnapchatHandle error", error);
      return { handle: null };
    }

    logger.auth("Snapchat handle saved", { handle });
    return { handle };
  } catch (err) {
    logger.error("saveSnapchatHandle exception", err);
    return { handle: null };
  }
}

/**
 * Save/update the user's note (max 40 chars).
 * Pass null or empty string to clear.
 */
export async function saveNote(rawNote: string | null): Promise<boolean> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      logger.error("saveNote: no user");
      return false;
    }

    const note = rawNote?.trim() || null;

    if (note && note.length > 40) {
      logger.error("saveNote: exceeds 40 chars", { length: note.length });
      return false;
    }

    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ note })
      .eq("id", user.id)
      .select("id");

    if (error) {
      logger.error("saveNote error", error);
      return false;
    }

    // Check that a row was actually updated (H5 fix)
    if (!updated || updated.length === 0) {
      logger.error("saveNote: no profile row found for user", { userId: user.id });
      return false;
    }

    // Also update the active ephemeral token so nearby users see the change
    // immediately (within the next 5s polling tick) instead of waiting for
    // the next token rotation (~15 min).
    const { error: rpcError } = await supabase.rpc("update_active_note", {
      p_note: note,
    });
    if (rpcError) {
      // Non-fatal: profile is saved, token will catch up on next rotation
      logger.error("update_active_note RPC error (non-fatal)", rpcError);
    }

    logger.auth("Note saved", { note });
    return true;
  } catch (err) {
    logger.error("saveNote exception", err);
    return false;
  }
}

/**
 * Save/update the user's nearby alerts preference.
 */
export async function saveNearbyAlertsPreference(
  enabled: boolean,
): Promise<boolean> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      logger.error("saveNearbyAlertsPreference: no user");
      return false;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ nearby_alerts_enabled: enabled, nearby_alerts_onboarded: true })
      .eq("id", user.id);

    if (error) {
      logger.error("saveNearbyAlertsPreference error", error);
      return false;
    }

    logger.auth("Nearby alerts preference saved", { enabled });
    return true;
  } catch (err) {
    logger.error("saveNearbyAlertsPreference exception", err);
    return false;
  }
}

/**
 * Save/update the user's daily engagement pushes preference.
 */
export async function saveDailyPushesPreference(
  enabled: boolean,
): Promise<boolean> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      logger.error("saveDailyPushesPreference: no user");
      return false;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ daily_pushes_enabled: enabled })
      .eq("id", user.id);

    if (error) {
      logger.error("saveDailyPushesPreference error", error);
      return false;
    }

    logger.auth("Daily pushes preference saved", { enabled });
    return true;
  } catch (err) {
    logger.error("saveDailyPushesPreference exception", err);
    return false;
  }
}

/**
 * Sync the device timezone and last_active_at to the user's profile.
 * Called on app open. Throttled to once per 7 days for timezone,
 * but always updates last_active_at.
 */
export async function syncTimezoneAndActivity(): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const now = Date.now();
    const updates: Record<string, unknown> = {
      last_active_at: new Date().toISOString(),
    };

    // Sync timezone on every app open — cheap write, prevents engagement
    // notifications at wrong local time when users travel.
    // Previously throttled to 7 days, but a user flying NY→Tokyo would get
    // push notifications at 4 AM for a week. Not worth the micro-optimization.
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // Validate: IANA timezones contain a "/" (e.g. "America/New_York", "Asia/Tokyo")
      // Reject bare offsets like "UTC" or invalid strings
      if (tz && tz.includes("/")) {
        updates.timezone = tz;
      }
    } catch {
      // Intl not available on some engines — skip
    }

    // Sync device locale (e.g. "en", "fr", "de-DE") so push notifications
    // can be sent in the user's language
    try {
      const deviceLocale = getLocales()?.[0]?.languageTag;
      if (deviceLocale) {
        updates.locale = deviceLocale;
      }
    } catch {
      // expo-localization not available — skip
    }

    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", user.id);

    if (error) {
      logger.error("syncTimezoneAndActivity error", error);
    }
  } catch (err) {
    logger.error("syncTimezoneAndActivity exception", err);
  }
}
