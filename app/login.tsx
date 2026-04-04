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

  // Smart provider memory — remember which method the user last signed in with
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

  const isReturningUser = memoryLoaded && lastProvider !== null;

  /** Check if tapping this provider would create a new account */
  const wouldCreateNewAccount = (provider: AuthProvider): boolean => {
    if (!lastProvider) return false; // first-time user, all methods are new
    if (provider === lastProvider) return false; // same method as last sign-in
    if (linkedProviders.includes(provider)) return false; // linked to current account
    if (knownProviders.includes(provider)) return false; // used before on this device (different account exists)
    return true;
  };

  const handleSignIn = async (provider: "google" | "apple") => {
    if (signingInRef.current) return;

    // Warn if this would create a new account
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

  // Provider button config
  const providerButtons: {
    key: AuthProvider;
    icon: "logo-apple" | "logo-google" | "call-outline";
    label: string;
    onPress: () => void;
    isPrimary?: boolean;
    bgClass: string;
    textColor: string;
    iconColor: string;
  }[] = [
    {
      key: "apple",
      icon: "logo-apple",
      label: t("login.continueApple"),
      onPress: () => handleSignIn("apple"),
      bgClass: "bg-white",
      textColor: "text-black",
      iconColor: "black",
    },
    {
      key: "google",
      icon: "logo-google",
      label: t("login.continueGoogle"),
      onPress: () => handleSignIn("google"),
      bgClass: "bg-wave-surface border border-wave-muted/30",
      textColor: "text-white",
      iconColor: "white",
    },
    {
      key: "phone",
      icon: "call-outline",
      label: t("login.continuePhone"),
      onPress: handlePhonePress,
      bgClass: "bg-wave-surface border border-wave-muted/30",
      textColor: "text-white",
      iconColor: "white",
    },
  ];

  // For returning users, put their last provider first and make it primary
  const sortedButtons = isReturningUser
    ? [
        ...providerButtons.filter((b) => b.key === lastProvider).map((b) => ({ ...b, isPrimary: true })),
        ...providerButtons.filter((b) => b.key !== lastProvider),
      ]
    : providerButtons;

  // While loading provider memory, show nothing to avoid flash
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

      <Text className="text-5xl font-bold text-white mb-3">{t("common.wave")}</Text>

      {isReturningUser && (
        <Text className="text-wave-muted text-sm mb-8">{t("login.welcomeBack")}</Text>
      )}

      {/* How it works — only for first-time users */}
      {!isReturningUser && (
        <View className="mb-12 items-center mt-7">
          {STEPS.map((step, i) => (
            <View key={i} className="flex-row items-center mb-5">
              <View className="w-10 h-10 rounded-full bg-wave-surface items-center justify-center mr-3">
                <Ionicons name={step.icon} size={20} color={COLORS.primary} />
              </View>
              <Text className="text-white text-sm">{step.text}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Sign in buttons */}
      <View className={`w-full ${isReturningUser ? "mt-4" : ""}`} style={{ gap: 12 }}>
        {sortedButtons.map((btn) => {
          const isPrimary = btn.isPrimary;
          const isLoading = loadingProvider === btn.key;
          const isPhone = btn.key === "phone";

          return (
            <TouchableOpacity
              key={btn.key}
              onPress={btn.onPress}
              disabled={loadingProvider !== null}
              className={`w-full rounded-2xl py-4 flex-row items-center justify-center ${
                isPrimary
                  ? "bg-wave-primary"
                  : btn.key === "apple"
                    ? "bg-white"
                    : "bg-wave-surface border border-wave-muted/30"
              }`}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <ActivityIndicator color={isPrimary ? "white" : btn.iconColor} size="small" />
              ) : (
                <>
                  <Ionicons
                    name={btn.icon}
                    size={20}
                    color={isPrimary ? "white" : btn.iconColor}
                    style={{ marginRight: 8 }}
                  />
                  <Text
                    className={`text-base font-semibold ${
                      isPrimary ? "text-white" : btn.textColor
                    }`}
                  >
                    {btn.label}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {isReturningUser && (
        <Text className="text-wave-muted text-xs text-center mt-3 leading-5 px-4">
          {t("login.linkHint")}
        </Text>
      )}

      <Text className="text-wave-muted text-xs text-center mt-4 leading-5">
        {t("common.identityHidden")}
      </Text>
    </View>
  );
}
