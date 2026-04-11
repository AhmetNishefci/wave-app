import { useCallback } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheet } from "@/components/BottomSheet";
import { impactLight } from "@/utils/haptics";
import i18n, { changeAppLanguage, resetToDeviceLanguage } from "@/i18n";
import { syncLocaleToServer } from "@/services/profile";
import { COLORS } from "@/constants/colors";
import type { ToastVariant } from "@/components/Toast";

const LANGUAGES = [
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
  { code: "pt", name: "Portuguese", flag: "🇵🇹" },
  { code: "tr", name: "Turkish", flag: "🇹🇷" },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  showToast: (msg: string, variant?: ToastVariant) => void;
};

export function LanguagePickerSheet({ visible, onClose, showToast }: Props) {
  const { t } = useTranslation();
  const langCode = i18n.language?.substring(0, 2) ?? "en";

  const handleChangeLanguage = useCallback((code: string) => {
    impactLight();
    changeAppLanguage(code);
    syncLocaleToServer(code);
    onClose();
  }, [onClose]);

  const handleResetLanguage = useCallback(() => {
    impactLight();
    resetToDeviceLanguage().then(() => {
      const deviceLang = i18n.language;
      syncLocaleToServer(deviceLang);
    }).catch(() => {
      showToast(t("settings.genericError"), "error");
    });
    onClose();
  }, [onClose, showToast, t]);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text className="text-white text-lg font-semibold text-center mb-4">{t("common.language")}</Text>
      <View style={{ gap: 4 }}>
        {/* System Default option */}
        <TouchableOpacity
          onPress={handleResetLanguage}
          className="flex-row items-center justify-between rounded-xl py-3 px-4 bg-wave-bg"
          activeOpacity={0.7}
        >
          <View className="flex-row items-center">
            <Text className="text-lg mr-3">📱</Text>
            <Text className="text-wave-muted text-sm font-semibold">{t("settings.systemDefault")}</Text>
          </View>
        </TouchableOpacity>

        <View className="h-px bg-wave-muted/20 my-1" />

        {LANGUAGES.map((lang) => {
          const isSelected = lang.code === langCode;
          return (
            <TouchableOpacity
              key={lang.code}
              onPress={() => handleChangeLanguage(lang.code)}
              className={`flex-row items-center justify-between rounded-xl py-3 px-4 ${
                isSelected ? "bg-wave-primary/15 border border-wave-primary/30" : "bg-wave-bg"
              }`}
              activeOpacity={0.7}
            >
              <View className="flex-row items-center">
                <Text className="text-lg mr-3">{lang.flag}</Text>
                <Text className={`text-sm font-semibold ${isSelected ? "text-white" : "text-wave-muted"}`}>
                  {lang.name}
                </Text>
              </View>
              {isSelected && (
                <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </BottomSheet>
  );
}
