import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Wave",
  slug: "wave",
  version: "1.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  newArchEnabled: true,
  scheme: "wave",
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#0a0a0a",
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.ahmetnishefci.waveapp",
    appleTeamId: "MC275WP2T8",
    entitlements: {
      "aps-environment": process.env.EAS_BUILD_PROFILE === "production" ? "production" : "development",
      "com.apple.developer.applesignin": ["Default"],
    },
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSBluetoothAlwaysUsageDescription:
        "Wave uses Bluetooth to discover nearby people and connect with them.",
      NSBluetoothPeripheralUsageDescription:
        "Wave broadcasts your presence so nearby people can discover you.",
      NSLocationWhenInUseUsageDescription:
        "Wave uses your location to notify you when other Wave users are nearby.",
      UIBackgroundModes: ["bluetooth-central", "bluetooth-peripheral", "remote-notification"],
      LSApplicationQueriesSchemes: ["instagram", "snapchat"],
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#0a0a0a",
    },
    package: "com.ahmetnishefci.waveapp",
    permissions: [
      "BLUETOOTH",
      "BLUETOOTH_ADMIN",
      "BLUETOOTH_SCAN",
      "BLUETOOTH_ADVERTISE",
      "BLUETOOTH_CONNECT",
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
    ],
  },
  extra: {
    eas: {
      projectId: "80494bfb-f7d5-4924-b53c-c1721a95cddb",
    },
  },
  plugins: [
    "expo-router",
    "expo-web-browser",
    "expo-apple-authentication",
    ...(process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME
      ? [
          [
            "@react-native-google-signin/google-signin",
            { iosUrlScheme: process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME },
          ] as [string, { iosUrlScheme: string }],
        ]
      : []),
    [
      "react-native-ble-plx",
      {
        isBackgroundEnabled: true,
        modes: ["central", "peripheral"],
        bluetoothAlwaysPermission:
          "Wave uses Bluetooth to discover nearby people.",
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/icon.png",
        sounds: [],
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Wave uses your location to notify you when other Wave users are nearby.",
      },
    ],
    [
      "@sentry/react-native/expo",
      {
        organization: "wave-99",
        project: "react-native",
      },
    ],
  ],
});
