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
  name: string;
  description: string;
  /** 3 preview colors shown in the preset card: [primary, wave/accent, match] */
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
  bg: "#08090c",
  surface: "#131420",
  primary: "#f96b66",
  accent: "#38cc9b",
  text: "#eeeef2",
  muted: "#9596ac",
  danger: "#f43e5c",
  wave: "#1accf4",
  match: "#bf8fef",
  placeholder: "#65678b",
  switchOff: "#212231",
  toastSuccess: "#16a34a",
  toastError: "#dc2626",
  snapchat: "#FFFC00",
  white: "#ffffff",
  black: "#000000",
};

const ULTRAVIOLET: ThemeColors = {
  bg: "#09090b",
  surface: "#181726",
  primary: "#8372e3",
  accent: "#2eb88a",
  text: "#e6e6e6",
  muted: "#8b899f",
  danger: "#dc2828",
  wave: "#25d0bf",
  match: "#eb4799",
  placeholder: "#65637e",
  switchOff: "#262537",
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
  wave: "#30abe8",
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
  wave: "#9a74e7",
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
  surface: "#18141a",
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
    name: "Midnight",
    description: "Classic purple & teal",
    preview: ["#6c63ff", "#4ecdc4", "#ec4899"],
    colors: MIDNIGHT_DEFAULT,
  },
  {
    id: "warm_midnight",
    name: "Warm Signal",
    description: "Coral & cyan - warm meets electric",
    preview: ["#f96b66", "#1accf4", "#bf8fef"],
    colors: WARM_MIDNIGHT,
  },
  {
    id: "ultraviolet",
    name: "Ultraviolet",
    description: "Classic purple & teal",
    preview: ["#8372e3", "#25d0bf", "#eb4799"],
    colors: ULTRAVIOLET,
  },
  {
    id: "solar",
    name: "Solar",
    description: "Warm amber & golden glow",
    preview: ["#f9941f", "#f4c025", "#e64c7f"],
    colors: SOLAR,
  },
  {
    id: "arctic",
    name: "Arctic",
    description: "Cool ice blue & silver",
    preview: ["#35b7f3", "#9a74e7", "#e458b5"],
    colors: ARCTIC,
  },
  {
    id: "neon_noir",
    name: "Neon Noir",
    description: "Hot pink & electric lime",
    preview: ["#f53d99", "#91e619", "#f9d51f"],
    colors: NEON_NOIR,
  },
];

export const DEFAULT_THEME_ID = "midnight_default";

export function getThemeById(id: string): ThemeColors {
  const preset = THEME_PRESETS.find((t) => t.id === id);
  return preset?.colors ?? MIDNIGHT_DEFAULT;
}
