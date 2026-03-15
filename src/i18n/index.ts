import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as Localization from "expo-localization";
import AsyncStorage from "@react-native-async-storage/async-storage";
import en from "./locales/en.json";
import de from "./locales/de.json";
import fr from "./locales/fr.json";
import es from "./locales/es.json";
import it from "./locales/it.json";
import pt from "./locales/pt.json";
import tr from "./locales/tr.json";

const LANGUAGE_KEY = "wave-language";

/**
 * i18n configuration for Wave.
 *
 * - Checks AsyncStorage for a manually chosen language first
 * - Falls back to device language via expo-localization
 * - Falls back to English if neither is available
 * - Manual override: call changeAppLanguage("fr") from settings
 */
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
    fr: { translation: fr },
    es: { translation: es },
    it: { translation: it },
    pt: { translation: pt },
    tr: { translation: tr },
  },
  lng: Localization.getLocales()?.[0]?.languageCode ?? "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

// Restore persisted language choice on startup
AsyncStorage.getItem(LANGUAGE_KEY)
  .then((saved) => {
    if (saved && saved !== i18n.language) {
      i18n.changeLanguage(saved);
    }
  })
  .catch(() => {
    // AsyncStorage read failed — stay on device language
  });

/**
 * Change the app language and persist the choice.
 * Use this instead of i18n.changeLanguage() directly.
 * Callers should also sync the locale to the server via syncLocaleToServer().
 */
export async function changeAppLanguage(code: string): Promise<void> {
  await i18n.changeLanguage(code);
  await AsyncStorage.setItem(LANGUAGE_KEY, code);
}

/**
 * Reset to device language (removes the manual override).
 */
export async function resetToDeviceLanguage(): Promise<void> {
  await AsyncStorage.removeItem(LANGUAGE_KEY);
  const deviceLang = Localization.getLocales()?.[0]?.languageCode ?? "en";
  await i18n.changeLanguage(deviceLang);
}

export default i18n;
