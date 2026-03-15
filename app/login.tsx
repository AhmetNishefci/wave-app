import { useState, useRef } from "react";
import { View, Text, Image, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { signInWithGoogle, signInWithApple } from "@/services/auth";
import { fetchAndRoute } from "@/utils/routeFromProfile";
import { COLORS } from "@/constants/colors";
import { impactMedium } from "@/utils/haptics";

const waveHand = require("../assets/wave-hand.png");

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const STEPS = [
    { icon: "radio-outline" as const, text: t("login.discoverPeople") },
    { icon: "hand-left-outline" as const, text: t("login.sendWave") },
    { icon: "people-outline" as const, text: t("login.matchWaveBack") },
  ];
  const [loadingProvider, setLoadingProvider] = useState<"google" | "apple" | null>(null);
  const signingInRef = useRef(false);

  const handleSignIn = async (provider: "google" | "apple") => {
    if (signingInRef.current) return;
    signingInRef.current = true;

    impactMedium();
    setLoadingProvider(provider);

    const { success, error } = provider === "apple"
      ? await signInWithApple()
      : await signInWithGoogle();

    if (success) {
      // Fetch profile and navigate directly — avoids flashing the splash screen.
      // Keep spinner on the button while this runs.
      const routed = await fetchAndRoute(router);
      if (!routed) {
        // Profile fetch failed — fall back to splash screen which handles retries
        router.replace("/");
      }
      return;
    } else {
      setLoadingProvider(null);
      signingInRef.current = false;
      if (error && error !== "cancelled") {
        Alert.alert(t("common.signInFailed"), error);
      }
    }
  };

  return (
    <View
      className="flex-1 bg-wave-bg items-center justify-center px-8"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
        {/* Glow behind hand icon */}
        <View style={{ position: "relative", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
          <View
            style={{
              position: "absolute",
              width: 120,
              height: 120,
              borderRadius: 60,
              backgroundColor: COLORS.primary,
              opacity: 0.15,
            }}
          />
          <Image
            source={waveHand}
            style={{ width: 100, height: 100 }}
            resizeMode="contain"
          />
        </View>

        <Text className="text-5xl font-bold text-white mb-10">{t("common.wave")}</Text>

        {/* How it works */}
        <View className="mb-12 items-center">
          {STEPS.map((step, i) => (
            <View key={i} className="flex-row items-center mb-5">
              <View className="w-10 h-10 rounded-full bg-wave-surface items-center justify-center mr-3">
                <Ionicons name={step.icon} size={20} color={COLORS.primary} />
              </View>
              <Text className="text-white text-sm">{step.text}</Text>
            </View>
          ))}
        </View>

        {/* Sign in buttons */}
        <View className="w-full" style={{ gap: 12 }}>
          <TouchableOpacity
            onPress={() => handleSignIn("apple")}
            disabled={loadingProvider !== null}
            className="w-full bg-white rounded-2xl py-4 flex-row items-center justify-center"
            activeOpacity={0.8}
          >
            {loadingProvider === "apple" ? (
              <ActivityIndicator color="black" size="small" />
            ) : (
              <>
                <Ionicons name="logo-apple" size={20} color="black" style={{ marginRight: 8 }} />
                <Text className="text-black text-base font-semibold">
                  {t("login.continueApple")}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => handleSignIn("google")}
            disabled={loadingProvider !== null}
            className="w-full bg-wave-surface rounded-2xl py-4 flex-row items-center justify-center border border-wave-muted/30"
            activeOpacity={0.8}
          >
            {loadingProvider === "google" ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <>
                <Ionicons name="logo-google" size={20} color="white" style={{ marginRight: 8 }} />
                <Text className="text-white text-base font-semibold">
                  {t("login.continueGoogle")}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push("/phone-login")}
            disabled={loadingProvider !== null}
            className="w-full bg-wave-surface rounded-2xl py-4 flex-row items-center justify-center border border-wave-muted/30"
            activeOpacity={0.8}
          >
            <Ionicons name="call-outline" size={20} color="white" style={{ marginRight: 8 }} />
            <Text className="text-white text-base font-semibold">
              {t("login.continuePhone")}
            </Text>
          </TouchableOpacity>
        </View>

        <Text className="text-wave-muted text-xs text-center mt-4 leading-5">
          {t("common.identityHidden")}
        </Text>
    </View>
  );
}
