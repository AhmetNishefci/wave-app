import { useState, useEffect, useRef, type RefObject } from "react";
import type { TextInput as RNTextInput } from "react-native";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { saveInstagramHandle, saveSnapchatHandle } from "@/services/profile";
import { useAuthStore } from "@/stores/authStore";
import { impactMedium } from "@/utils/haptics";
import { OnboardingProgress } from "@/components/OnboardingProgress";
import { COLORS } from "@/constants/colors";

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [igHandle, setIgHandle] = useState("");
  const [scHandle, setScHandle] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const snapchatInputRef = useRef<RNTextInput>(null);

  // Auth guard (H1 fix)
  useEffect(() => {
    if (!isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, router]);

  const handleContinue = async () => {
    const trimmedIg = igHandle.trim().replace(/^@/, "");
    const trimmedSc = scHandle.trim().replace(/^@/, "");

    if (!trimmedIg && !trimmedSc) {
      Alert.alert(t("onboarding.required"), t("onboarding.requireDescription"));
      return;
    }

    // Double-tap guard (M4 fix)
    if (savingRef.current) return;
    savingRef.current = true;

    impactMedium();
    setSaving(true);

    // Save whichever handles are provided
    let igSaved: string | null = null;
    let scSaved: string | null = null;

    if (trimmedIg) {
      const result = await saveInstagramHandle(trimmedIg);
      if (!result.handle) {
        setSaving(false);
        savingRef.current = false;
        if (result.error === "taken") {
          Alert.alert(t("onboarding.usernameTaken"), t("onboarding.instagramTaken"));
        } else {
          Alert.alert(t("onboarding.invalidUsername"), t("onboarding.instagramInvalid"));
        }
        return;
      }
      igSaved = result.handle;
    }

    if (trimmedSc) {
      const result = await saveSnapchatHandle(trimmedSc);
      if (!result.handle) {
        setSaving(false);
        savingRef.current = false;
        if (result.error === "taken") {
          Alert.alert(t("onboarding.usernameTaken"), t("onboarding.snapchatTaken"));
        } else {
          Alert.alert(t("onboarding.invalidUsername"), t("onboarding.snapchatInvalid"));
        }
        return;
      }
      scSaved = result.handle;
    }

    setSaving(false);
    savingRef.current = false;

    if (igSaved) useAuthStore.getState().setInstagramHandle(igSaved);
    if (scSaved) useAuthStore.getState().setSnapchatHandle(scSaved);
    router.replace("/note");
  };

  const hasAnyInput = igHandle.trim().replace(/^@/, "").length > 0 || scHandle.trim().replace(/^@/, "").length > 0;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-wave-bg"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 32 }}
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        keyboardShouldPersistTaps="handled"
      >
        <OnboardingProgress step={3} />

        <View className="w-12 h-12 rounded-full bg-wave-surface items-center justify-center mb-6">
          <Ionicons name="chatbubbles-outline" size={24} color={COLORS.primary} />
        </View>

        <Text className="text-2xl font-bold text-white mb-2">
          {t("onboarding.title")}
        </Text>
        <Text className="text-wave-muted text-sm text-center mb-8 leading-5">
          {t("onboarding.description")}
        </Text>

        {/* Instagram input */}
        <View className="w-full mb-4">
          <View className="flex-row items-center mb-2">
            <Ionicons name="logo-instagram" size={16} color={COLORS.primary} />
            <Text className="text-wave-muted text-xs ml-1.5">{t("onboarding.instagram")}</Text>
          </View>
          <View className="w-full bg-wave-surface rounded-2xl px-4 flex-row items-center" style={{ height: 52 }}>
            <Text className="text-wave-muted text-base" style={{ lineHeight: 20 }}>@</Text>
            <TextInput
              value={igHandle}
              onChangeText={setIgHandle}
              placeholder={t("common.username")}
              placeholderTextColor={COLORS.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              className="flex-1 text-white text-base ml-1"
              style={{ lineHeight: 20, paddingVertical: 0 }}
              returnKeyType="next"
              onSubmitEditing={() => snapchatInputRef.current?.focus()}
            />
          </View>
        </View>

        {/* Snapchat input */}
        <View className="w-full mb-6">
          <View className="flex-row items-center mb-2">
            <Ionicons name="logo-snapchat" size={16} color={COLORS.snapchat} />
            <Text className="text-wave-muted text-xs ml-1.5">{t("onboarding.snapchat")}</Text>
          </View>
          <View className="w-full bg-wave-surface rounded-2xl px-4 flex-row items-center" style={{ height: 52 }}>
            <TextInput
              ref={snapchatInputRef}
              value={scHandle}
              onChangeText={setScHandle}
              placeholder={t("common.username")}
              placeholderTextColor={COLORS.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              className="flex-1 text-white text-base"
              style={{ lineHeight: 20, paddingVertical: 0 }}
              returnKeyType="done"
              onSubmitEditing={handleContinue}
            />
          </View>
        </View>

        <TouchableOpacity
          onPress={handleContinue}
          disabled={saving || !hasAnyInput}
          className={`w-full rounded-2xl py-4 items-center justify-center ${
            hasAnyInput ? "bg-wave-primary" : "bg-wave-surface"
          }`}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color={COLORS.white} size="small" />
          ) : (
            <Text className={`text-base font-semibold ${hasAnyInput ? "text-white" : "text-wave-muted"}`}>
              {t("common.continue")}
            </Text>
          )}
        </TouchableOpacity>

        <Text className="text-wave-muted text-xs text-center mt-4 leading-5">
          {t("onboarding.socialsHidden")}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
