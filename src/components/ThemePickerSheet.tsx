import { useState } from "react";
import { View, Text, TouchableOpacity, TextInput, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/BottomSheet";
import { useThemeStore } from "@/stores/themeStore";
import { THEME_PRESETS, DEFAULT_THEME_ID, type ThemeColors } from "@/constants/themes";
import { COLORS } from "@/constants/colors";
import { impactLight } from "@/utils/haptics";

/** Color tokens exposed to the custom editor, with user-friendly labels */
const CUSTOM_COLOR_KEYS: { key: keyof ThemeColors; label: string }[] = [
  { key: "bg", label: "Background" },
  { key: "surface", label: "Surface" },
  { key: "primary", label: "Primary" },
  { key: "accent", label: "Accent" },
  { key: "text", label: "Text" },
  { key: "muted", label: "Muted Text" },
  { key: "danger", label: "Danger" },
  { key: "wave", label: "Wave Action" },
  { key: "match", label: "Match" },
  { key: "placeholder", label: "Placeholder" },
  { key: "switchOff", label: "Switch Off" },
];

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function ThemePickerSheet({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const customOverrides = useThemeStore((s) => s.customOverrides);
  const setTheme = useThemeStore((s) => s.setTheme);
  const setCustomOverride = useThemeStore((s) => s.setCustomOverride);
  const resetToDefault = useThemeStore((s) => s.resetToDefault);

  const [showCustom, setShowCustom] = useState(Object.keys(customOverrides).length > 0);
  const [editingKey, setEditingKey] = useState<keyof ThemeColors | null>(null);
  const [hexInput, setHexInput] = useState("");

  const handleSelectPreset = (themeId: string) => {
    if (themeId === activeThemeId && Object.keys(customOverrides).length === 0) return;
    impactLight();
    setTheme(themeId);
    setEditingKey(null);
  };

  const handleReset = () => {
    Alert.alert(
      t("settings.resetTheme"),
      t("settings.resetThemeConfirm"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("settings.resetTheme"),
          onPress: () => {
            impactLight();
            resetToDefault();
            setShowCustom(false);
            setEditingKey(null);
          },
        },
      ],
    );
  };

  const handleColorTap = (key: keyof ThemeColors) => {
    if (editingKey === key) {
      setEditingKey(null);
      return;
    }
    const currentValue = customOverrides[key] ?? COLORS[key];
    setHexInput(currentValue);
    setEditingKey(key);
  };

  const handleHexSubmit = () => {
    if (!editingKey) return;
    const trimmed = hexInput.trim();
    // Validate hex color
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      impactLight();
      setCustomOverride(editingKey, trimmed);
      setEditingKey(null);
    } else if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
      impactLight();
      setCustomOverride(editingKey, `#${trimmed}`);
      setEditingKey(null);
    } else {
      Alert.alert(t("common.error"), t("settings.invalidHex"));
    }
  };

  const resolvedColors = useThemeStore.getState().getActiveColors();
  const hasOverrides = Object.keys(customOverrides).length > 0;
  const isDefault = activeThemeId === DEFAULT_THEME_ID && !hasOverrides;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 500 }}>
        {/* Title */}
        <Text className="text-white text-lg font-semibold text-center mb-4">
          {t("settings.theme")}
        </Text>

        {/* Preset grid */}
        <View className="flex-row flex-wrap mb-4" style={{ gap: 8 }}>
          {THEME_PRESETS.map((preset) => {
            const isActive = preset.id === activeThemeId && !hasOverrides;
            return (
              <TouchableOpacity
                key={preset.id}
                onPress={() => handleSelectPreset(preset.id)}
                className={`rounded-xl p-3 border ${
                  isActive
                    ? "border-wave-primary bg-wave-primary/10"
                    : "border-wave-muted/20 bg-wave-bg"
                }`}
                style={{ width: "48%" }}
                activeOpacity={0.7}
              >
                {/* Preview dots */}
                <View className="flex-row mb-2" style={{ gap: 6 }}>
                  {preset.preview.map((color, i) => (
                    <View
                      key={i}
                      style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: color }}
                    />
                  ))}
                </View>
                <Text className="text-white text-sm font-semibold">{preset.name}</Text>
                <Text className="text-wave-muted text-xs mt-0.5" numberOfLines={1}>
                  {preset.description}
                </Text>
                {isActive && (
                  <View className="absolute top-2 right-2">
                    <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Custom colors toggle */}
        <TouchableOpacity
          onPress={() => { setShowCustom(!showCustom); setEditingKey(null); }}
          className="flex-row items-center justify-center py-2 mb-3"
          activeOpacity={0.7}
        >
          <Ionicons name="options-outline" size={16} color={COLORS.muted} style={{ marginRight: 6 }} />
          <Text className="text-wave-muted text-sm">
            {showCustom ? t("settings.hideCustomColors") : t("settings.showCustomColors")}
          </Text>
        </TouchableOpacity>

        {/* Custom color editor */}
        {showCustom && (
          <View className="mb-4">
            <Text className="text-wave-muted text-xs uppercase tracking-wider mb-3">
              {t("settings.customColors")}
            </Text>

            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {CUSTOM_COLOR_KEYS.map(({ key, label }) => {
                const color = resolvedColors[key];
                const isEditing = editingKey === key;
                const isOverridden = key in customOverrides;

                return (
                  <View key={key} style={{ width: "48%" }}>
                    <TouchableOpacity
                      onPress={() => handleColorTap(key)}
                      className={`rounded-xl px-3 py-2.5 flex-row items-center border ${
                        isEditing
                          ? "border-wave-primary bg-wave-primary/10"
                          : isOverridden
                            ? "border-wave-accent/30 bg-wave-bg"
                            : "border-transparent bg-wave-bg"
                      }`}
                      activeOpacity={0.7}
                    >
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          backgroundColor: color,
                          borderWidth: 1,
                          borderColor: "rgba(255,255,255,0.15)",
                          marginRight: 10,
                        }}
                      />
                      <View className="flex-1">
                        <Text className="text-white text-xs font-semibold">{label}</Text>
                        <Text className="text-wave-muted text-xs">{color}</Text>
                      </View>
                    </TouchableOpacity>

                    {/* Inline hex editor */}
                    {isEditing && (
                      <View className="flex-row items-center mt-1.5" style={{ gap: 6 }}>
                        <TextInput
                          value={hexInput}
                          onChangeText={setHexInput}
                          placeholder="#000000"
                          placeholderTextColor={COLORS.placeholder}
                          autoCapitalize="none"
                          autoCorrect={false}
                          maxLength={7}
                          autoFocus
                          returnKeyType="done"
                          onSubmitEditing={handleHexSubmit}
                          className="flex-1 bg-wave-surface rounded-lg px-3 text-white text-xs"
                          style={{ height: 32, paddingVertical: 0 }}
                        />
                        <TouchableOpacity
                          onPress={handleHexSubmit}
                          className="bg-wave-primary rounded-lg px-3 items-center justify-center"
                          style={{ height: 32 }}
                        >
                          <Ionicons name="checkmark" size={16} color="white" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Reset to default */}
        {!isDefault && (
          <TouchableOpacity
            onPress={handleReset}
            className="flex-row items-center justify-center py-3 mb-2"
            activeOpacity={0.7}
          >
            <Ionicons name="refresh-outline" size={16} color={COLORS.muted} style={{ marginRight: 6 }} />
            <Text className="text-wave-muted text-sm">{t("settings.resetTheme")}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </BottomSheet>
  );
}
