import { useState, useRef } from "react";
import { View, Text, TouchableOpacity, TextInput, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/BottomSheet";
import { useThemeStore } from "@/stores/themeStore";
import { THEME_PRESETS, DEFAULT_THEME_ID, type ThemeColors } from "@/constants/themes";
import { COLORS } from "@/constants/colors";
import { impactLight, impactMedium } from "@/utils/haptics";
import ColorPicker, { Panel1, HueSlider } from "reanimated-color-picker";

// ─── Curated color palette ─────────────────────────────────────
// 24 colors in 3 rows: vibrant spectrum, secondary hues, grayscale.
// Covers all use cases (bright accents, dark backgrounds, light text)
// without requiring users to know hex codes.

const PALETTE = [
  // Row 1: Primary spectrum (warm → cool)
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1",
  // Row 2: Secondary hues (pinks, purples, alternatives)
  "#ec4899", "#f43f5e", "#a855f7", "#d946ef", "#84cc16", "#fbbf24", "#0ea5e9", "#8b5cf6",
  // Row 3: Grayscale (dark backgrounds → light text)
  "#000000", "#0a0a0a", "#1a1a2e", "#27272a", "#6b7280", "#9ca3af", "#e0e0e0", "#ffffff",
];

const PALETTE_COLS = 8;
const DOT_SIZE = 28;
const DOT_GAP = 6;

/** Color tokens exposed to the custom editor, with i18n label keys */
const CUSTOM_COLOR_KEYS: { key: keyof ThemeColors; labelKey: string }[] = [
  { key: "bg", labelKey: "settings.colorBg" },
  { key: "surface", labelKey: "settings.colorSurface" },
  { key: "primary", labelKey: "settings.colorPrimary" },
  { key: "accent", labelKey: "settings.colorAccent" },
  { key: "text", labelKey: "settings.colorText" },
  { key: "muted", labelKey: "settings.colorMuted" },
  { key: "danger", labelKey: "settings.colorDanger" },
  { key: "wave", labelKey: "settings.colorWave" },
  { key: "match", labelKey: "settings.colorMatch" },
  { key: "placeholder", labelKey: "settings.colorPlaceholder" },
  { key: "switchOff", labelKey: "settings.colorSwitchOff" },
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
  const removeCustomOverride = useThemeStore((s) => s.removeCustomOverride);
  const resetToDefault = useThemeStore((s) => s.resetToDefault);

  const scrollRef = useRef<ScrollView>(null);
  const [showCustom, setShowCustom] = useState(Object.keys(customOverrides).length > 0);
  const [editingKey, setEditingKey] = useState<keyof ThemeColors | null>(null);
  const [showHexInput, setShowHexInput] = useState(false);
  const [hexInput, setHexInput] = useState("");
  const [expandedColor, setExpandedColor] = useState<string | null>(null);
  const lastPickerChangeRef = useRef(0);

  const handleSelectPreset = (themeId: string) => {
    if (themeId === activeThemeId && Object.keys(customOverrides).length === 0) return;
    impactLight();
    setTheme(themeId);
    setEditingKey(null);
    setShowHexInput(false);
    setExpandedColor(null);
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
            setShowHexInput(false);
            setExpandedColor(null);
          },
        },
      ],
    );
  };

  const handleColorTap = (key: keyof ThemeColors) => {
    if (editingKey === key) {
      setEditingKey(null);
      setShowHexInput(false);
      setExpandedColor(null);
      return;
    }
    const currentValue = customOverrides[key] ?? COLORS[key];
    setHexInput(currentValue);
    setEditingKey(key);
    setShowHexInput(false);
    setExpandedColor(null);
    // Auto-scroll so the palette is visible after layout
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  const applyColor = (key: keyof ThemeColors, value: string) => {
    impactLight();
    setCustomOverride(key, value);
    return true;
  };

  const handlePalettePick = (color: string) => {
    if (!editingKey) return;
    setExpandedColor(null);
    applyColor(editingKey, color);
  };

  const handlePaletteLongPress = (color: string) => {
    impactMedium();
    const next = expandedColor === color ? null : color;
    setExpandedColor(next);
    if (next) {
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  };

  // Live preview during drag — throttled to avoid re-rendering the tree 60fps.
  // Calls setCustomOverride directly (no haptic during drag).
  const handlePickerChange = ({ hex }: { hex: string }) => {
    if (!editingKey) return;
    const now = Date.now();
    if (now - lastPickerChangeRef.current < 150) return;
    lastPickerChangeRef.current = now;
    setCustomOverride(editingKey, hex);
  };

  // Final apply on finger release — with haptic feedback.
  const handlePickerComplete = ({ hex }: { hex: string }) => {
    if (!editingKey) return;
    applyColor(editingKey, hex);
  };

  const handleHexSubmit = () => {
    if (!editingKey) return;
    const trimmed = hexInput.trim();
    let finalHex: string | null = null;
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      finalHex = trimmed;
    } else if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
      finalHex = `#${trimmed}`;
    }
    if (!finalHex) {
      Alert.alert(t("common.error"), t("settings.invalidHex"));
      return;
    }
    applyColor(editingKey, finalHex);
    setHexInput(finalHex);
  };

  const handleResetSingleColor = (key: keyof ThemeColors) => {
    impactLight();
    removeCustomOverride(key);
    // If no overrides remain, collapse the custom section
    const remaining = useThemeStore.getState().customOverrides;
    if (Object.keys(remaining).length === 0) {
      setShowCustom(false);
    }
  };

  const resolvedColors = useThemeStore.getState().getActiveColors();
  const hasOverrides = Object.keys(customOverrides).length > 0;
  const isDefault = activeThemeId === DEFAULT_THEME_ID && !hasOverrides;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} style={{ maxHeight: 500 }}>
        {/* Title */}
        <Text className="text-white text-lg font-semibold text-center mb-4">
          {t("settings.theme")}
        </Text>

        {/* Preset grid */}
        <View className="flex-row flex-wrap mb-4" style={{ gap: 8 }}>
          {THEME_PRESETS.map((preset) => {
            const isActive = preset.id === activeThemeId;
            return (
              <TouchableOpacity
                key={preset.id}
                onPress={() => handleSelectPreset(preset.id)}
                className={`rounded-xl p-3 border ${
                  isActive
                    ? "border-transparent"
                    : "border-wave-muted/20 bg-wave-bg"
                }`}
                style={[
                  { width: "48%" },
                  isActive ? {
                    borderColor: resolvedColors.primary,
                    backgroundColor: resolvedColors.primary + "1A",
                  } : undefined,
                ]}
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
                <Text className="text-white text-sm font-semibold">{t(preset.nameKey)}</Text>
                <Text className="text-wave-muted text-xs mt-0.5" numberOfLines={1}>
                  {t(preset.descKey)}
                </Text>
                {isActive && (
                  <View className="absolute top-2 right-2">
                    <Ionicons name="checkmark-circle" size={18} color={resolvedColors.primary} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Custom colors toggle */}
        <TouchableOpacity
          onPress={() => { setShowCustom(!showCustom); setEditingKey(null); setShowHexInput(false); setExpandedColor(null); }}
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
              {CUSTOM_COLOR_KEYS.map(({ key, labelKey }) => {
                const color = resolvedColors[key];
                const isEditing = editingKey === key;
                const isOverridden = key in customOverrides;

                return (
                  <View key={key} style={{ width: "48%" }}>
                    <TouchableOpacity
                      onPress={() => handleColorTap(key)}
                      className={`rounded-xl px-3 py-2.5 flex-row items-center border ${
                        isEditing || isOverridden
                          ? "border-transparent"
                          : "border-transparent bg-wave-bg"
                      }`}
                      style={
                        isEditing || isOverridden
                          ? { borderColor: resolvedColors.primary + "4D", backgroundColor: resolvedColors.primary + "1A" }
                          : undefined
                      }
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
                        <Text className="text-white text-xs font-semibold">{t(labelKey)}</Text>
                      </View>
                      {isOverridden && (
                        <TouchableOpacity
                          onPress={() => handleResetSingleColor(key)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="close-circle" size={16} color={COLORS.muted} />
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>

            {/* Color picker: full width below the grid */}
            {editingKey && (
              <View className="mt-2 bg-wave-surface/50 rounded-xl p-2.5">
                <View style={{ gap: DOT_GAP }}>
                  {Array.from({ length: Math.ceil(PALETTE.length / PALETTE_COLS) }, (_, row) => (
                    <View key={row} className="flex-row justify-center" style={{ gap: DOT_GAP }}>
                      {PALETTE.slice(row * PALETTE_COLS, (row + 1) * PALETTE_COLS).map((paletteColor) => {
                        const isSelected = resolvedColors[editingKey].toLowerCase() === paletteColor.toLowerCase();
                        return (
                          <TouchableOpacity
                            key={paletteColor}
                            onPress={() => handlePalettePick(paletteColor)}
                            onLongPress={() => handlePaletteLongPress(paletteColor)}
                            delayLongPress={300}
                            style={{
                              width: DOT_SIZE,
                              height: DOT_SIZE,
                              borderRadius: DOT_SIZE / 2,
                              backgroundColor: paletteColor,
                              borderWidth: isSelected || expandedColor === paletteColor ? 2.5 : 1,
                              borderColor: isSelected || expandedColor === paletteColor ? "#ffffff" : "rgba(255,255,255,0.12)",
                            }}
                          />
                        );
                      })}
                    </View>
                  ))}
                </View>

                {/* Hint for long-press */}
                {!expandedColor && (
                  <Text className="text-wave-muted text-xs text-center mt-2">
                    {t("settings.longPressHint")}
                  </Text>
                )}

                {/* Color picker — shown on long-press of a palette dot */}
                {expandedColor && (
                  <View className="mt-3">
                    <ColorPicker
                      value={expandedColor}
                      onChangeJS={handlePickerChange}
                      onCompleteJS={handlePickerComplete}
                      style={{ gap: 12 }}
                    >
                      <Panel1 style={{ height: 150, borderRadius: 12 }} />
                      <HueSlider style={{ height: 28, borderRadius: 14 }} />
                    </ColorPicker>
                  </View>
                )}

                <TouchableOpacity
                  onPress={() => setShowHexInput(!showHexInput)}
                  className="flex-row items-center justify-center mt-2.5 py-1"
                  activeOpacity={0.7}
                >
                  <Text className="text-wave-muted text-xs">
                    {showHexInput ? t("settings.hidHexInput") : t("settings.customHex")}
                  </Text>
                </TouchableOpacity>

                {showHexInput && (
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
                      className="flex-1 bg-wave-bg rounded-lg px-3 text-white text-xs"
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
            )}
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
