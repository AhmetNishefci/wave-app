/**
 * Theme preset definitions.
 *
 * Each theme is a complete color map. The keys match both the Tailwind
 * CSS variable names (--color-wave-*) and the COLORS constant keys.
 * Adding a new theme = adding a new object here. Changing the default =
 * changing DEFAULT_THEME_ID.
 */

export interface ThemeColors {
  bg: string;
  surface: string;
  primary: string;
  accent: string;
  text: string;
  muted: string;
  danger: string;
  wave: string;
  match: string;
  placeholder: string;
  switchOff: string;
  toastSuccess: string;
  toastError: string;
  snapchat: string;
  white: string;
  black: string;
}

export interface ThemePreset {
  id: string;
  /** i18n key for the theme name (settings.themeMidnight, etc.) */
  nameKey: string;
  /** i18n key for the theme description */
  descKey: string;
  /** 3 preview colors shown in the preset card: [primary, wave, match] */
  preview: [string, string, string];
  colors: ThemeColors;
}

// ─── Default theme (current app colors) ─────────────────────────

export const MIDNIGHT_DEFAULT: ThemeColors = {
  bg: "#0a0a0a",
  surface: "#1a1a2e",
  primary: "#6c63ff",
  accent: "#00d4aa",
  text: "#e0e0e0",
  muted: "#8585a0",
  danger: "#ff4757",
  wave: "#4ecdc4",
  match: "#ec4899",
  placeholder: "#555570",
  switchOff: "#333345",
  toastSuccess: "#16a34a",
  toastError: "#dc2626",
  snapchat: "#FFFC00",
  white: "#ffffff",
  black: "#000000",
};

// ─── Designer presets ───────────────────────────────────────────

const WARM_MIDNIGHT: ThemeColors = {
  bg: "#0c0908",
  surface: "#1e1315",
  primary: "#f96b66",
  accent: "#38cc9b",
  text: "#eeeef2",
  muted: "#9596ac",
  danger: "#f43e5c",
  wave: "#14d4c0",
  match: "#bf8fef",
  placeholder: "#8b6567",
  switchOff: "#312122",
  toastSuccess: "#16a34a",
  toastError: "#dc2626",
  snapchat: "#FFFC00",
  white: "#ffffff",
  black: "#000000",
};

const EMERALD: ThemeColors = {
  bg: "#060b08",
  surface: "#0f1a14",
  primary: "#10b981",
  accent: "#f59e0b",
  text: "#e4efe8",
  muted: "#7a9486",
  danger: "#ef4444",
  wave: "#e8a830",
  match: "#f472b6",
  placeholder: "#567263",
  switchOff: "#1e2e26",
  toastSuccess: "#16a34a",
  toastError: "#dc2626",
  snapchat: "#FFFC00",
  white: "#ffffff",
  black: "#000000",
};

const SOLAR: ThemeColors = {
  bg: "#0c0a09",
  surface: "#1e1815",
  primary: "#f9941f",
  accent: "#f4c025",
  text: "#efebe7",
  muted: "#958b83",
  danger: "#e83030",
  wave: "#e8825c",
  match: "#e64c7f",
  placeholder: "#70635c",
  switchOff: "#2f2723",
  toastSuccess: "#16a34a",
  toastError: "#dc2626",
  snapchat: "#FFFC00",
  white: "#ffffff",
  black: "#000000",
};

const ARCTIC: ThemeColors = {
  bg: "#0a0c10",
  surface: "#161b22",
  primary: "#35b7f3",
  accent: "#33ccb3",
  text: "#e7ebef",
  muted: "#7e8a9a",
  danger: "#ef3957",
  wave: "#8b9cf7",
  match: "#e458b5",
  placeholder: "#5c697a",
  switchOff: "#212830",
  toastSuccess: "#16a34a",
  toastError: "#dc2626",
  snapchat: "#FFFC00",
  white: "#ffffff",
  black: "#000000",
};

const NEON_NOIR: ThemeColors = {
  bg: "#08070b",
  surface: "#201b24",
  primary: "#f53d99",
  accent: "#91e619",
  text: "#ede9ed",
  muted: "#887b8e",
  danger: "#ee2b2b",
  wave: "#13ecda",
  match: "#f9d51f",
  placeholder: "#63576b",
  switchOff: "#27222b",
  toastSuccess: "#16a34a",
  toastError: "#dc2626",
  snapchat: "#FFFC00",
  white: "#ffffff",
  black: "#000000",
};

// ─── Preset registry ────────────────────────────────────────────

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "midnight_default",
    nameKey: "settings.themeMidnight",
    descKey: "settings.themeMidnightDesc",
    preview: ["#6c63ff", "#4ecdc4", "#ec4899"],
    colors: MIDNIGHT_DEFAULT,
  },
  {
    id: "warm_midnight",
    nameKey: "settings.themeWarmSignal",
    descKey: "settings.themeWarmSignalDesc",
    preview: ["#f96b66", "#14d4c0", "#bf8fef"],
    colors: WARM_MIDNIGHT,
  },
  {
    id: "emerald",
    nameKey: "settings.themeEmerald",
    descKey: "settings.themeEmeraldDesc",
    preview: ["#10b981", "#e8a830", "#f472b6"],
    colors: EMERALD,
  },
  {
    id: "solar",
    nameKey: "settings.themeSolar",
    descKey: "settings.themeSolarDesc",
    preview: ["#f9941f", "#e8825c", "#e64c7f"],
    colors: SOLAR,
  },
  {
    id: "arctic",
    nameKey: "settings.themeArctic",
    descKey: "settings.themeArcticDesc",
    preview: ["#35b7f3", "#8b9cf7", "#e458b5"],
    colors: ARCTIC,
  },
  {
    id: "neon_noir",
    nameKey: "settings.themeNeonNoir",
    descKey: "settings.themeNeonNoirDesc",
    preview: ["#f53d99", "#13ecda", "#f9d51f"],
    colors: NEON_NOIR,
  },
];

export const DEFAULT_THEME_ID = "midnight_default";

export function getThemeById(id: string): ThemeColors {
  const preset = THEME_PRESETS.find((t) => t.id === id);
  return preset?.colors ?? MIDNIGHT_DEFAULT;
}
