import { View } from "react-native";
import { vars } from "nativewind";
import { useThemeStore } from "@/stores/themeStore";
import { getThemeById, type ThemeColors } from "@/constants/themes";

/**
 * Wraps the app root to apply theme CSS variables via NativeWind's vars() API.
 * When the user switches themes, the store update triggers a re-render,
 * which recalculates CSS variables, and all Tailwind wave-* classes
 * re-render with the new colors automatically.
 *
 * NOTE: No `key` prop — CSS variable updates flow through NativeWind's
 * runtime cascade. A key prop would remount the entire app tree,
 * destroying BLE connections, navigation state, and component state.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const customOverrides = useThemeStore((s) => s.customOverrides);

  // Resolve full color map: preset base + any custom overrides
  const base = getThemeById(activeThemeId);
  const colors: ThemeColors = Object.keys(customOverrides).length > 0
    ? { ...base, ...customOverrides } as ThemeColors
    : base;

  const themeVars = vars({
    "--color-wave-bg": colors.bg,
    "--color-wave-surface": colors.surface,
    "--color-wave-primary": colors.primary,
    "--color-wave-accent": colors.accent,
    "--color-wave-text": colors.text,
    "--color-wave-muted": colors.muted,
    "--color-wave-danger": colors.danger,
    "--color-wave-wave": colors.wave,
    "--color-wave-match": colors.match,
  });

  return (
    <View style={[{ flex: 1 }, themeVars]}>
      {children}
    </View>
  );
}
