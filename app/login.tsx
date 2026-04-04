import { useState, useRef, useEffect } from "react";
import { View, Text, Image, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { signInWithGoogle, signInWithApple } from "@/services/auth";
import {
  getLastAuthProvider,
  getLinkedProviderCache,
  getKnownProviders,
  type AuthProvider,
} from "@/services/authLinking";
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

  // Provider memory for mismatch warnings
  const [lastProvider, setLastProvider] = useState<AuthProvider | null>(null);
  const [linkedProviders, setLinkedProviders] = useState<AuthProvider[]>([]);
  const [knownProviders, setKnownProviders] = useState<AuthProvider[]>([]);
  const [memoryLoaded, setMemoryLoaded] = useState(false);

  useEffect(() => {
    Promise.all([getLastAuthProvider(), getLinkedProviderCache(), getKnownProviders()]).then(
      ([last, linked, known]) => {
        setLastProvider(last);
        setLinkedProviders(linked);
        setKnownProviders(known);
        setMemoryLoaded(true);
      },
    );
  }, []);

  /** Check if tapping this provider would create a new account */
  const wouldCreateNewAccount = (provider: AuthProvider): boolean => {
    if (!lastProvider) return false;
    if (provider === lastProvider) return false;
    if (linkedProviders.includes(provider)) return false;
    if (knownProviders.includes(provider)) return false;
    return true;
  };

  const handleSignIn = async (provider: "google" | "apple") => {
    if (signingInRef.current) return;

    if (wouldCreateNewAccount(provider)) {
      const providerName = provider === "apple" ? "Apple" : "Google";
      const lastProviderName = lastProvider === "apple" ? "Apple" : lastProvider === "google" ? "Google" : t("login.phone");

      Alert.alert(
        t("login.differentAccountTitle"),
        t("login.differentAccountMessage", { provider: providerName, lastProvider: lastProviderName }),
        [
          { text: t("login.useOriginal", { provider: lastProviderName }), style: "cancel" },
          {
            text: t("login.createNewAccount"),
            style: "destructive",
            onPress: () => doSignIn(provider),
          },
        ],
      );
      return;
    }

    doSignIn(provider);
  };

  const doSignIn = async (provider: "google" | "apple") => {
    if (signingInRef.current) return;
    signingInRef.current = true;

    impactMedium();
    setLoadingProvider(provider);

    const { success, error } = provider === "apple"
      ? await signInWithApple()
      : await signInWithGoogle();

    if (success) {
      const routed = await fetchAndRoute(router);
      if (!routed) {
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

  const handlePhonePress = () => {
    if (wouldCreateNewAccount("phone")) {
      const lastProviderName = lastProvider === "apple" ? "Apple" : lastProvider === "google" ? "Google" : t("login.phone");

      Alert.alert(
        t("login.differentAccountTitle"),
        t("login.differentAccountMessage", { provider: t("login.phone"), lastProvider: lastProviderName }),
        [
          { text: t("login.useOriginal", { provider: lastProviderName }), style: "cancel" },
          {
            text: t("login.createNewAccount"),
            style: "destructive",
            onPress: () => router.push("/phone-login"),
          },
        ],
      );
      return;
    }
    router.push("/phone-login");
  };

  if (!memoryLoaded) return <View className="flex-1 bg-wave-bg" />;

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

      {/* Sign in buttons — fixed order: Apple, Google, Phone */}
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
          onPress={handlePhonePress}
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
