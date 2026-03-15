import { useState, useEffect, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { saveNote } from "@/services/profile";
import { useAuthStore } from "@/stores/authStore";
import { impactMedium } from "@/utils/haptics";
import { OnboardingProgress } from "@/components/OnboardingProgress";
import { COLORS } from "@/constants/colors";

const MAX_NOTE_LENGTH = 40;

export default function NoteScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Auth guard (H1 fix)
  useEffect(() => {
    if (!isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, router]);

  const handleContinue = async () => {
    // Double-tap guard (M4 fix)
    if (savingRef.current) return;

    const trimmed = note.trim();
    if (!trimmed) {
      impactMedium();
      useAuthStore.getState().setNote(null);
      router.replace("/nearby-alerts");
      return;
    }

    savingRef.current = true;
    impactMedium();
    setSaving(true);

    const success = await saveNote(trimmed);
    setSaving(false);
    savingRef.current = false;

    if (!success) {
      Alert.alert(
        t("common.couldntSave"),
        t("note.saveError"),
        [{ text: t("note.continueButton"), onPress: () => router.replace("/nearby-alerts") }],
      );
      return;
    }

    useAuthStore.getState().setNote(trimmed);
    router.replace("/nearby-alerts");
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-wave-bg"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View
        className="flex-1 items-center justify-center px-8"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <OnboardingProgress step={4} />

        <View className="w-12 h-12 rounded-full bg-wave-surface items-center justify-center mb-6">
          <Ionicons name="pencil-outline" size={24} color={COLORS.primary} />
        </View>

        <Text className="text-2xl font-bold text-white mb-2">
          {t("note.title")}
        </Text>
        <Text className="text-wave-muted text-sm text-center mb-8 leading-5">
          {t("note.description")}
        </Text>

        <View className="w-full bg-wave-surface rounded-2xl px-4 flex-row items-center mb-2" style={{ height: 52 }}>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={t("note.placeholder")}
            placeholderTextColor={COLORS.placeholder}
            autoCapitalize="sentences"
            autoCorrect={false}
            className="flex-1 text-white text-base"
            style={{ lineHeight: 20, paddingVertical: 0 }}
            returnKeyType="done"
            onSubmitEditing={handleContinue}
            maxLength={MAX_NOTE_LENGTH}
          />
        </View>

        <Text className="text-wave-muted text-xs self-end mb-4">
          {note.length}/{MAX_NOTE_LENGTH}
        </Text>

        <TouchableOpacity
          onPress={handleContinue}
          disabled={saving}
          className={`w-full rounded-2xl py-4 items-center justify-center ${
            note.trim()
              ? "bg-wave-primary"
              : "border border-wave-muted/50"
          }`}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color={COLORS.white} size="small" />
          ) : (
            <Text className={`text-base font-semibold ${note.trim() ? "text-white" : "text-wave-muted"}`}>
              {note.trim() ? t("common.continue") : t("note.skipForNow")}
            </Text>
          )}
        </TouchableOpacity>

        <Text className="text-wave-muted text-xs text-center mt-6 leading-5">
          {t("note.optional")}
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}
