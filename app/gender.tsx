import { useEffect, useState, useRef, useCallback } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, ScrollView, BackHandler } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { saveGenderProfile } from "@/services/profile";
import { useAuthStore } from "@/stores/authStore";
import { impactMedium, impactLight } from "@/utils/haptics";
import { AgeRangeSlider } from "@/components/AgeRangeSlider";
import { OnboardingProgress } from "@/components/OnboardingProgress";
import { getAgeFromDob, getDefaultAgeRange } from "@/utils/age";
import type { Gender, GenderPreference } from "@/types";
import { COLORS } from "@/constants/colors";

export default function GenderScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const GENDER_OPTIONS: { value: Gender; label: string; icon: string }[] = [
    { value: "male", label: t("gender.male"), icon: "male" },
    { value: "female", label: t("gender.female"), icon: "female" },
  ];

  const PREFERENCE_OPTIONS: { value: GenderPreference; label: string }[] = [
    { value: "male", label: t("gender.men") },
    { value: "female", label: t("gender.women") },
    { value: "both", label: t("gender.everyone") },
  ];
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const existingGender = useAuthStore((s) => s.gender);
  const dateOfBirth = useAuthStore((s) => s.dateOfBirth);
  // Default to null so user must actively choose (M3 fix)
  const [gender, setGender] = useState<Gender | null>(null);
  const [preference, setPreference] = useState<GenderPreference | null>(null);

  // Age preference with smart default from DOB
  const userAge = dateOfBirth ? getAgeFromDob(dateOfBirth) : 25;
  const [defaultMin, defaultMax] = getDefaultAgeRange(userAge);
  const [ageMin, setAgeMin] = useState(defaultMin);
  const [ageMax, setAgeMax] = useState(defaultMax);

  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Auth guard: redirect unauthenticated users (H1 fix)
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

  // If gender is already set, skip this screen
  useEffect(() => {
    if (existingGender) {
      router.replace("/onboarding");
    }
  }, [existingGender, router]);

  const canContinue = gender !== null && preference !== null;

  const handleContinue = async () => {
    if (!gender || !preference) return;
    // Double-tap guard (M4 fix)
    if (savingRef.current) return;
    savingRef.current = true;

    impactMedium();
    setSaving(true);

    const success = await saveGenderProfile(gender, preference, ageMin, ageMax);
    setSaving(false);
    savingRef.current = false;

    if (!success) {
      Alert.alert(t("common.couldntSave"), t("gender.saveError"));
      return;
    }

    useAuthStore.getState().setGender(gender);
    useAuthStore.getState().setGenderPreference(preference);
    useAuthStore.getState().setAgePreference(ageMin, ageMax);
    router.replace("/onboarding");
  };

  const handleAgeChange = useCallback((lo: number, hi: number) => {
    setAgeMin(lo);
    setAgeMax(hi);
  }, []);

  return (
    <ScrollView
      className="flex-1 bg-wave-bg"
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 32,
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 16,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <OnboardingProgress step={2} />

      {/* Icon */}
      <View className="w-12 h-12 rounded-full bg-wave-surface items-center justify-center mb-6">
        <Ionicons name="person-outline" size={24} color={COLORS.primary} />
      </View>

      <Text className="text-2xl font-bold text-white mb-2">{t("gender.title")}</Text>
      <Text className="text-wave-muted text-sm text-center mb-8 leading-5">
        {t("gender.description")}
      </Text>

      {/* Gender Selection */}
      <Text className="text-wave-muted text-xs uppercase tracking-wider self-start mb-3">
        {t("gender.iAm")}
      </Text>
      <View className="w-full flex-row mb-8" style={{ gap: 12 }}>
        {GENDER_OPTIONS.map((option) => {
          const selected = gender === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              onPress={() => {
                impactLight();
                setGender(option.value);
              }}
              className={`flex-1 rounded-2xl py-4 items-center justify-center border-2 ${
                selected
                  ? "bg-wave-primary/20 border-wave-primary"
                  : "bg-wave-surface border-transparent"
              }`}
              activeOpacity={0.8}
            >
              <Ionicons
                name={option.icon as any}
                size={28}
                color={selected ? COLORS.primary : COLORS.muted}
              />
              <Text
                className={`text-base font-semibold mt-2 ${
                  selected ? "text-white" : "text-wave-muted"
                }`}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Preference Selection */}
      <Text className="text-wave-muted text-xs uppercase tracking-wider self-start mb-3">
        {t("gender.showMe")}
      </Text>
      <View className="w-full mb-8" style={{ gap: 10 }}>
        {PREFERENCE_OPTIONS.map((option) => {
          const selected = preference === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              onPress={() => {
                impactLight();
                setPreference(option.value);
              }}
              className={`w-full rounded-2xl py-3.5 px-4 flex-row items-center justify-between border-2 ${
                selected
                  ? "bg-wave-primary/20 border-wave-primary"
                  : "bg-wave-surface border-transparent"
              }`}
              activeOpacity={0.8}
            >
              <Text
                className={`text-base font-semibold ${
                  selected ? "text-white" : "text-wave-muted"
                }`}
              >
                {option.label}
              </Text>
              {selected && (
                <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Age Preference */}
      <Text className="text-wave-muted text-xs uppercase tracking-wider self-start mb-3">
        {t("gender.ageRange")}
      </Text>
      <View className="w-full bg-wave-surface rounded-2xl p-4 mb-8">
        <AgeRangeSlider min={ageMin} max={ageMax} onChangeEnd={handleAgeChange} />
      </View>

      {/* Continue Button */}
      <TouchableOpacity
        onPress={handleContinue}
        disabled={saving || !canContinue}
        className={`w-full rounded-2xl py-4 items-center justify-center ${
          canContinue ? "bg-wave-primary" : "bg-wave-surface"
        }`}
        activeOpacity={0.8}
      >
        {saving ? (
          <ActivityIndicator color={COLORS.white} size="small" />
        ) : (
          <Text
            className={`text-base font-semibold ${
              canContinue ? "text-white" : "text-wave-muted"
            }`}
          >
            {t("common.continue")}
          </Text>
        )}
      </TouchableOpacity>

      <Text className="text-wave-muted text-xs text-center mt-4 leading-5">
        {t("gender.permanenceWarning")}
      </Text>
    </ScrollView>
  );
}
