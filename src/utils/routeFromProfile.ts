import type { Router } from "expo-router";
import { useAuthStore } from "@/stores/authStore";
import { fetchProfile, syncTimezoneAndActivity } from "@/services/profile";
import { fetchMatchesFromServer } from "@/services/wave/matches";
import { isAtLeastAge } from "@/utils/age";
import { logger } from "@/utils/logger";

const FETCH_TIMEOUT_MS = 15_000; // 15s timeout per attempt to prevent infinite hang

/**
 * Fetch the user's profile and navigate to the correct screen based on
 * onboarding completeness. Used by both the splash screen (cold start)
 * and login screens (post sign-in) to avoid duplicate routing logic.
 *
 * Returns false if the profile fetch failed or timed out (caller should handle retry).
 */
export async function fetchAndRoute(router: Router): Promise<boolean> {
  let didResolve = false;
  const profile = await Promise.race([
    fetchProfile().then((p) => { didResolve = true; return p; }),
    new Promise<null>((resolve) => {
      setTimeout(() => {
        if (!didResolve) {
          logger.warn("Profile fetch timed out");
        }
        resolve(null);
      }, FETCH_TIMEOUT_MS);
    }),
  ]);
  if (!profile) return false;

  const {
    setDateOfBirth, setGender, setGenderPreference, setAgePreference,
    setInstagramHandle, setSnapchatHandle, setNote,
    setNearbyAlertsEnabled, setDailyPushesEnabled,
  } = useAuthStore.getState();

  // Age check — must happen before all other onboarding steps
  if (!profile.dateOfBirth) {
    logger.auth("No DOB, redirecting to birthday");
    router.replace("/birthday");
    return true;
  }

  if (!isAtLeastAge(new Date(profile.dateOfBirth + "T00:00:00"), 18)) {
    logger.auth("User under 18, redirecting to age-blocked");
    setDateOfBirth(profile.dateOfBirth);
    router.replace("/age-blocked");
    return true;
  }

  setDateOfBirth(profile.dateOfBirth);

  if (!profile.gender) {
    logger.auth("No gender, redirecting to gender");
    router.replace("/gender");
    return true;
  }

  setGender(profile.gender);
  setGenderPreference(profile.genderPreference);
  setAgePreference(profile.agePreferenceMin, profile.agePreferenceMax);

  if (!profile.instagramHandle && !profile.snapchatHandle) {
    logger.auth("No contact handles, redirecting to onboarding");
    router.replace("/onboarding");
    return true;
  }

  setInstagramHandle(profile.instagramHandle);
  setSnapchatHandle(profile.snapchatHandle);
  setNote(profile.note);
  setNearbyAlertsEnabled(profile.nearbyAlertsEnabled);
  setDailyPushesEnabled(profile.dailyPushesEnabled);

  if (!profile.nearbyAlertsOnboarded) {
    logger.auth("Nearby alerts not configured, redirecting");
    router.replace("/nearby-alerts");
    return true;
  }

  // Background syncs (non-blocking)
  syncTimezoneAndActivity().catch((err) =>
    logger.warn("Timezone/activity sync failed", err),
  );
  fetchMatchesFromServer().catch((err) =>
    logger.warn("Background match fetch failed", err),
  );

  logger.auth("Session valid, navigating to radar");
  router.replace("/(main)/radar");
  return true;
}
