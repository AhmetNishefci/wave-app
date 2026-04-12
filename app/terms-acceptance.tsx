import { useState, useRef, useEffect } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, BackHandler, Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { acceptTerms } from "@/services/profile";
import { fetchAndRoute } from "@/utils/routeFromProfile";
import { impactMedium } from "@/utils/haptics";
import { COLORS } from "@/constants/colors";

const TERMS_URL = "https://www.wavenearby.com/terms";
const PRIVACY_URL = "https://www.wavenearby.com/privacy";

export default function TermsAcceptanceScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Prevent Android back button from skipping terms
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  const handleContinue = async () => {
    if (!accepted || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    impactMedium();

    try {
      const success = await acceptTerms();
      if (success) {
        await fetchAndRoute(router);
      } else {
        Alert.alert(t("common.error"), t("common.somethingWentWrong"));
      }
    } catch {
      Alert.alert(t("common.error"), t("common.somethingWentWrong"));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  return (
    <View
      className="flex-1 bg-wave-bg px-8 justify-center"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      {/* Icon */}
      <View className="items-center mb-6">
        <View className="w-16 h-16 rounded-full bg-wave-primary/20 items-center justify-center border-2 border-wave-primary/40">
          <Ionicons name="shield-checkmark-outline" size={32} color={COLORS.primary} />
        </View>
      </View>

      {/* Title */}
      <Text className="text-3xl font-bold text-white text-center mb-3">
        {t("terms.title")}
      </Text>
      <Text className="text-wave-muted text-sm text-center leading-5 mb-10">
        {t("terms.subtitle")}
      </Text>

      {/* Links */}
      <View className="bg-wave-surface rounded-2xl p-4 mb-6" style={{ gap: 2 }}>
        <TouchableOpacity
          onPress={() => WebBrowser.openBrowserAsync(TERMS_URL)}
          className="flex-row items-center justify-between py-3"
          activeOpacity={0.7}
        >
          <View className="flex-row items-center">
            <Ionicons name="document-text-outline" size={18} color={COLORS.text} style={{ marginRight: 10 }} />
            <Text className="text-white text-sm">{t("terms.termsLink")}</Text>
          </View>
          <Ionicons name="open-outline" size={14} color={COLORS.muted} />
        </TouchableOpacity>

        <View className="h-px bg-wave-bg" />

        <TouchableOpacity
          onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)}
          className="flex-row items-center justify-between py-3"
          activeOpacity={0.7}
        >
          <View className="flex-row items-center">
            <Ionicons name="lock-closed-outline" size={18} color={COLORS.text} style={{ marginRight: 10 }} />
            <Text className="text-white text-sm">{t("terms.privacyLink")}</Text>
          </View>
          <Ionicons name="open-outline" size={14} color={COLORS.muted} />
        </TouchableOpacity>
      </View>

      {/* Checkbox */}
      <TouchableOpacity
        onPress={() => setAccepted(!accepted)}
        className="flex-row items-center mb-8"
        activeOpacity={0.7}
      >
        <View
          className={`w-6 h-6 rounded-md border-2 items-center justify-center mr-3 ${
            accepted ? "bg-wave-primary border-wave-primary" : "border-wave-muted"
          }`}
        >
          {accepted && <Ionicons name="checkmark" size={16} color="white" />}
        </View>
        <Text className="text-white text-sm flex-1 leading-5">
          {t("terms.agreeCheckbox")}
        </Text>
      </TouchableOpacity>

      {/* Continue button */}
      <TouchableOpacity
        onPress={handleContinue}
        disabled={!accepted || saving}
        className={`w-full rounded-2xl py-4 items-center ${
          accepted ? "bg-wave-primary" : "bg-wave-surface"
        }`}
        activeOpacity={0.8}
      >
        {saving ? (
          <ActivityIndicator color="white" size="small" />
        ) : (
          <Text className={`text-base font-semibold ${accepted ? "text-white" : "text-wave-muted"}`}>
            {t("terms.continue")}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
