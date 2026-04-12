/**
 * Dynamic color constants for use in native component props (Switch,
 * ActivityIndicator, RefreshControl, Ionicons) that can't use Tailwind classes.
 *
 * Reads from themeStore at access time, so colors update when the user
 * switches themes. For Tailwind className usage, the CSS variables in
 * ThemeProvider handle the updates automatically.
 */
import { useThemeStore } from "@/stores/themeStore";
import { MIDNIGHT_DEFAULT, type ThemeColors } from "@/constants/themes";

function getColor(prop: string): string {
  try {
    const colors = useThemeStore.getState().getActiveColors();
    return colors[prop as keyof ThemeColors] ?? MIDNIGHT_DEFAULT[prop as keyof ThemeColors] ?? "";
  } catch {
    // Store not initialized yet (module load time) — fall back to default
    return MIDNIGHT_DEFAULT[prop as keyof ThemeColors] ?? "";
  }
}

/**
 * COLORS is a getter-based object. Each property reads the current theme
 * colors at access time, ensuring native components always use the active theme.
 *
 * Typed as ThemeColors for autocomplete and type safety.
 * The Proxy resolves values dynamically at runtime.
 */
export const COLORS: Readonly<ThemeColors> = new Proxy({} as ThemeColors, {
  get(_target, prop: string) {
    return getColor(prop);
  },
});
