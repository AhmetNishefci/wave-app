import { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, Switch, Linking, BackHandler } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/stores/authStore";
import { saveNearbyAlertsPreference } from "@/services/profile";
import { requestLocationPermission } from "@/services/location";
import { impactMedium } from "@/utils/haptics";
import { OnboardingProgress } from "@/components/OnboardingProgress";
import { COLORS } from "@/constants/colors";

export default function NearbyAlertsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Auth guard
  useEffect(() => {
    if (!isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, router]);

  // Block Android hardware back button during onboarding
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  const handleContinue = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    impactMedium();

    // Save preference to server
    const success = await saveNearbyAlertsPreference(alertsEnabled);
    if (!success) {
      setSaving(false);
      savingRef.current = false;
      Alert.alert(t("common.couldntSave"), t("nearbyAlerts.saveError"));
      return;
    }

    useAuthStore.getState().setNearbyAlertsEnabled(alertsEnabled);

    // Request location permission if alerts are enabled
    if (alertsEnabled) {
      const permResult = await requestLocationPermission();
      if (permResult === "blocked") {
        // Permission permanently denied — guide user to Settings
        await saveNearbyAlertsPreference(false);
        useAuthStore.getState().setNearbyAlertsEnabled(false);
        Alert.alert(
          t("nearbyAlerts.locationNeeded"),
          t("nearbyAlerts.locationDenied"),
          [
            { text: t("nearbyAlerts.notNow"), style: "cancel" },
            { text: t("common.openSettings"), onPress: () => Linking.openSettings() },
          ],
        );
      } else if (permResult === "denied") {
        // User dismissed or denied (can ask again next time)
        await saveNearbyAlertsPreference(false);
        useAuthStore.getState().setNearbyAlertsEnabled(false);
      }
    }

    setSaving(false);
    savingRef.current = false;
    router.replace("/(main)/radar");
  };

  const handleSkip = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    impactMedium();
    setSaving(true);

    // Save as disabled — must succeed so the server records
    // nearby_alerts_onboarded: true, otherwise the user is re-routed
    // here on every app launch (L3 fix).
    const success = await saveNearbyAlertsPreference(false);
    if (!success) {
      setSaving(false);
      savingRef.current = false;
      Alert.alert(t("common.couldntSave"), t("nearbyAlerts.saveError"));
      return;
    }

    useAuthStore.getState().setNearbyAlertsEnabled(false);

    setSaving(false);
    savingRef.current = false;
    router.replace("/(main)/radar");
  };

  return (
    <View
      className="flex-1 bg-wave-bg items-center justify-center px-8"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <OnboardingProgress step={5} />

      {/* Icon */}
      <View className="w-16 h-16 rounded-full bg-wave-primary/20 items-center justify-center mb-6 border-2 border-wave-primary/40">
        <Ionicons name="location-outline" size={32} color={COLORS.primary} />
      </View>

      <Text className="text-2xl font-bold text-white mb-2">
        {t("nearbyAlerts.title")}
      </Text>
      <Text className="text-wave-muted text-sm text-center mb-8 leading-5 px-4">
        {t("nearbyAlerts.description")}
      </Text>

      {/* How it works */}
      <View className="w-full bg-wave-surface rounded-2xl p-5 mb-8">
        <View className="flex-row items-center mb-4">
          <View className="w-8 h-8 rounded-full bg-wave-primary/20 items-center justify-center mr-3">
            <Text className="text-sm">📍</Text>
          </View>
          <Text className="text-white text-sm flex-1">
            {t("nearbyAlerts.checkLocation")}
          </Text>
        </View>
        <View className="flex-row items-center mb-4">
          <View className="w-8 h-8 rounded-full bg-wave-primary/20 items-center justify-center mr-3">
            <Text className="text-sm">🔔</Text>
          </View>
          <Text className="text-white text-sm flex-1">
            {t("nearbyAlerts.notifyNearby")}
          </Text>
        </View>
        <View className="flex-row items-center">
          <View className="w-8 h-8 rounded-full bg-wave-primary/20 items-center justify-center mr-3">
            <Text className="text-sm">🔒</Text>
          </View>
          <Text className="text-white text-sm flex-1">
            {t("nearbyAlerts.locationPrivacy")}
          </Text>
        </View>
      </View>

      {/* Toggle */}
      <View className="w-full bg-wave-surface rounded-2xl p-4 mb-8 flex-row items-center justify-between">
        <View className="flex-1 mr-4">
          <Text className="text-white text-base font-semibold">{t("nearbyAlerts.toggleLabel")}</Text>
          <Text className="text-wave-muted text-xs mt-1">
            {t("nearbyAlerts.toggleSubtitle")}
          </Text>
        </View>
        <Switch
          value={alertsEnabled}
          onValueChange={setAlertsEnabled}
          trackColor={{ false: COLORS.switchOff, true: COLORS.primary }}
          thumbColor="white"
        />
      </View>

      {/* Continue button */}
      <TouchableOpacity
        onPress={handleContinue}
        disabled={saving}
        className="w-full bg-wave-primary rounded-2xl py-4 items-center justify-center mb-3"
        activeOpacity={0.8}
      >
        {saving ? (
          <ActivityIndicator color={COLORS.white} size="small" />
        ) : (
          <Text className="text-white text-base font-semibold">{t("common.continue")}</Text>
        )}
      </TouchableOpacity>

      {/* Skip */}
      <TouchableOpacity onPress={handleSkip} disabled={saving}>
        <Text className="text-wave-muted text-sm">{t("nearbyAlerts.skipForNow")}</Text>
      </TouchableOpacity>

      <Text className="text-wave-muted text-xs text-center mt-4 leading-5 px-4">
        {t("nearbyAlerts.canChange")}
      </Text>
    </View>
  );
}
