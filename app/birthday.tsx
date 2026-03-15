import { useEffect, useState, useRef } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { saveDateOfBirth } from "@/services/profile";
import { useAuthStore } from "@/stores/authStore";
import { impactMedium } from "@/utils/haptics";
import { isAtLeastAge } from "@/utils/age";
import { OnboardingProgress } from "@/components/OnboardingProgress";
import { COLORS } from "@/constants/colors";

export default function BirthdayScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const existingDob = useAuthStore((s) => s.dateOfBirth);

  // Default to 20 years ago so the picker opens at a reasonable spot
  const [date, setDate] = useState<Date>(
    () => new Date(new Date().getFullYear() - 20, 0, 1),
  );
  const [hasSelected, setHasSelected] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Auth guard
  useEffect(() => {
    if (!isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, router]);

  // If DOB is already set, skip forward (route to age-blocked if underage)
  useEffect(() => {
    if (existingDob) {
      if (isAtLeastAge(new Date(existingDob + "T00:00:00"), 18)) {
        router.replace("/gender");
      } else {
        router.replace("/age-blocked");
      }
    }
  }, [existingDob, router]);

  const tooYoung = hasSelected && !isAtLeastAge(date, 18);

  const handleDateChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    if (selectedDate) {
      setDate(selectedDate);
      setHasSelected(true);
    }
  };

  const handleContinue = async () => {
    if (!hasSelected || tooYoung) return;
    if (savingRef.current) return;
    savingRef.current = true;

    impactMedium();
    setSaving(true);

    // Format as YYYY-MM-DD in local time (not UTC) to avoid off-by-one in eastern timezones
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const dobString = `${y}-${m}-${d}`;
    const success = await saveDateOfBirth(dobString);

    setSaving(false);
    savingRef.current = false;

    if (!success) {
      Alert.alert(t("common.couldntSave"), t("birthday.saveError"));
      return;
    }

    useAuthStore.getState().setDateOfBirth(dobString);
    router.replace("/gender");
  };

  return (
    <View
      className="flex-1 bg-wave-bg items-center justify-center px-8"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <OnboardingProgress step={1} />

      {/* Icon */}
      <View className="w-12 h-12 rounded-full bg-wave-surface items-center justify-center mb-6">
        <Ionicons name="calendar-outline" size={24} color={COLORS.primary} />
      </View>

      <Text className="text-2xl font-bold text-white mb-2">{t("birthday.title")}</Text>
      <Text className="text-wave-muted text-sm text-center mb-8 leading-5">
        {t("birthday.description")}
      </Text>

      {/* Date Picker */}
      <View className="w-full bg-wave-surface rounded-2xl overflow-hidden mb-4">
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          maximumDate={new Date()}
          minimumDate={new Date(1920, 0, 1)}
          onChange={handleDateChange}
          themeVariant="dark"
          style={{ height: 180 }}
        />
      </View>

      {/* Age warning */}
      {tooYoung && (
        <View className="w-full bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
          <Text className="text-red-400 text-sm text-center">
            {t("birthday.ageWarning")}
          </Text>
        </View>
      )}

      {/* Continue Button */}
      <TouchableOpacity
        onPress={handleContinue}
        disabled={saving || !hasSelected || tooYoung}
        className={`w-full rounded-2xl py-4 items-center justify-center ${
          hasSelected && !tooYoung ? "bg-wave-primary" : "bg-wave-surface"
        }`}
        activeOpacity={0.8}
      >
        {saving ? (
          <ActivityIndicator color={COLORS.white} size="small" />
        ) : (
          <Text
            className={`text-base font-semibold ${
              hasSelected && !tooYoung ? "text-white" : "text-wave-muted"
            }`}
          >
            {t("common.continue")}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
