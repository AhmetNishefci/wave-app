import { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, Image, ActivityIndicator, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/stores/authStore";
import { fetchAndRoute } from "@/utils/routeFromProfile";
import { logger } from "@/utils/logger";
import { impactMedium } from "@/utils/haptics";
import { COLORS } from "@/constants/colors";

const waveHand = require("../assets/wave-hand.png");

const MAX_PROFILE_RETRIES = 3;

export default function IndexScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuthStore();
  const [fetchFailed, setFetchFailed] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  // Ref to track whether the current effect/retry chain is still valid.
  // Incremented on every new effect run so stale closures can bail out.
  const generationRef = useRef(0);

  // Ref to hold pending timeout IDs for cleanup (C2 fix)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigateWithRetry = useCallback(
    async (generation: number, retryCount: number) => {
      // Bail out if a newer effect run has started (C3 fix)
      if (generation !== generationRef.current) return;

      const success = await fetchAndRoute(router);

      // Check again after async gap
      if (generation !== generationRef.current) return;

      if (!success) {
        if (retryCount < MAX_PROFILE_RETRIES) {
          const nextRetry = retryCount + 1;
          const delay = 2000 * nextRetry;
          logger.error(
            `Failed to fetch profile, retry ${nextRetry}/${MAX_PROFILE_RETRIES} in ${delay}ms`,
          );
          timerRef.current = setTimeout(
            () => navigateWithRetry(generation, nextRetry),
            delay,
          );
        } else {
          logger.error("All profile fetch retries exhausted");
          setFetchFailed(true);
        }
      }
    },
    [router],
  );

  useEffect(() => {
    if (isLoading) return;

    // Increment generation to invalidate any in-flight retries from
    // a previous effect run (C3 fix)
    const generation = ++generationRef.current;
    setFetchFailed(false);
    setIsNavigating(false);

    if (!isAuthenticated) {
      logger.auth("No session, redirecting to login");
      router.replace("/login");
      return;
    }

    navigateWithRetry(generation, 0);

    // Cleanup: clear any pending timer on unmount or dep change (C2 fix)
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isAuthenticated, isLoading, router, navigateWithRetry]);

  // Retry handler with guard against concurrent taps (H3 fix)
  const handleRetry = useCallback(async () => {
    if (isNavigating) return;
    impactMedium();
    setIsNavigating(true);
    setFetchFailed(false);

    // Bail if auth state changed during fetch (L4 fix)
    if (!useAuthStore.getState().isAuthenticated) {
      setIsNavigating(false);
      return;
    }

    const success = await fetchAndRoute(router);

    if (!success) {
      setFetchFailed(true);
      setIsNavigating(false);
    }
  }, [isNavigating, router]);

  return (
    <View className="flex-1 items-center justify-center bg-wave-bg">
      <Image
        source={waveHand}
        style={{ width: 80, height: 80 }}
        resizeMode="contain"
      />
      <Text className="text-4xl font-bold text-white mb-6">{t("common.wave")}</Text>
      {fetchFailed ? (
        <View className="items-center">
          <Text className="text-wave-muted text-sm mb-4">
            {t("splash.connectionError")}
          </Text>
          <TouchableOpacity
            onPress={handleRetry}
            disabled={isNavigating}
            className="bg-wave-primary rounded-xl px-6 py-3"
          >
            {isNavigating ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <Text className="text-white text-sm font-semibold">{t("common.retry")}</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <ActivityIndicator size="small" color={COLORS.primary} />
      )}
    </View>
  );
}
