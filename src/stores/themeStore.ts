import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_THEME_ID, getThemeById, type ThemeColors } from "@/constants/themes";

interface ThemeState {
  /** ID of the active preset theme */
  activeThemeId: string;
  /** Per-color overrides (partial). Merged on top of the preset. */
  customOverrides: Partial<ThemeColors>;

  /** Get the fully resolved color map (preset + overrides) */
  getActiveColors: () => ThemeColors;

  setTheme: (themeId: string) => void;
  setCustomOverride: (key: keyof ThemeColors, value: string) => void;
  clearCustomOverrides: () => void;
  resetToDefault: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      activeThemeId: DEFAULT_THEME_ID,
      customOverrides: {},

      getActiveColors: () => {
        const base = getThemeById(get().activeThemeId);
        const overrides = get().customOverrides;
        if (Object.keys(overrides).length === 0) return base;
        return { ...base, ...overrides };
      },

      setTheme: (themeId) =>
        set({ activeThemeId: themeId, customOverrides: {} }),

      setCustomOverride: (key, value) =>
        set((state) => ({
          customOverrides: { ...state.customOverrides, [key]: value },
        })),

      clearCustomOverrides: () => set({ customOverrides: {} }),

      resetToDefault: () =>
        set({ activeThemeId: DEFAULT_THEME_ID, customOverrides: {} }),
    }),
    {
      name: "wave-theme",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
