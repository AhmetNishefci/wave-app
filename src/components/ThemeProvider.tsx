import { View } from "react-native";
import { vars } from "nativewind";
import { useThemeStore } from "@/stores/themeStore";
import { getThemeById, type ThemeColors } from "@/constants/themes";

/**
 * Convert a hex color to space-separated RGB channels.
 * e.g. "#4ecdc4" → "78 205 196"
 *
 * Required because Tailwind's opacity modifier (bg-color/20) needs
 * to inject an alpha value into the color function:
 *   rgb(var(--color) / 0.2)
 * This only works when the CSS variable contains RGB channels,
 * not a hex string.
 */
function hexToChannels(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

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

  // Pass RGB channels (not hex) so Tailwind's opacity modifier works:
  // bg-wave-primary/20 → rgb(var(--color-wave-primary) / 0.2)
  const themeVars = vars({
    "--color-wave-bg": hexToChannels(colors.bg),
    "--color-wave-surface": hexToChannels(colors.surface),
    "--color-wave-primary": hexToChannels(colors.primary),
    "--color-wave-accent": hexToChannels(colors.accent),
    "--color-wave-text": hexToChannels(colors.text),
    "--color-wave-muted": hexToChannels(colors.muted),
    "--color-wave-danger": hexToChannels(colors.danger),
    "--color-wave-wave": hexToChannels(colors.wave),
    "--color-wave-match": hexToChannels(colors.match),
  });

  return (
    <View style={[{ flex: 1 }, themeVars]}>
      {children}
    </View>
  );
}
