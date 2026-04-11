// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      "dist/*",
      "android/*",
      "ios/*",
      ".expo/*",
      "supabase/functions/*",
      "modules/expo-ble-peripheral/android/*",
      "modules/expo-ble-peripheral/ios/*",
    ],
  },
  {
    rules: {
      // require() is used intentionally for conditional/lazy imports in RN
      // (e.g., platform-specific modules, expo-haptics lazy load)
      "@typescript-eslint/no-require-imports": "off",
      // i18next default export is the standard usage pattern
      "import/no-named-as-default-member": "off",
    },
  },
]);
