import { useState, useRef, useEffect, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  Alert, KeyboardAvoidingView, Platform, FlatList, Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { sendPhoneOtp, verifyPhoneOtp } from "@/services/auth";
import { fetchAndRoute } from "@/utils/routeFromProfile";
import { impactMedium, impactLight } from "@/utils/haptics";
import { COLORS } from "@/constants/colors";
import { COUNTRIES, getCountryByCode, type Country } from "@/constants/countries";
import * as Localization from "expo-localization";
import i18n from "@/i18n";

function getLocalizedCountryName(code: string, fallback: string): string {
  try {
    const displayNames = new Intl.DisplayNames([i18n.language], { type: "region" });
    return displayNames.of(code) ?? fallback;
  } catch {
    return fallback;
  }
}

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

export default function PhoneLoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Phone input state
  const [country, setCountry] = useState<Country>(() => {
    // Auto-detect country from device locale (e.g., "en-US" → "US", "de-DE" → "DE")
    const region = Localization.getLocales()?.[0]?.regionCode;
    return region ? getCountryByCode(region) : getCountryByCode("US");
  });
  const [phoneNumber, setPhoneNumber] = useState("");
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");

  // OTP state
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [otpCode, setOtpCode] = useState("");
  const [resendTimer, setResendTimer] = useState(0);

  // Loading & guards
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const sendingRef = useRef(false);
  const verifyingRef = useRef(false);

  // OTP brute-force protection: lock out after 5 failed attempts for 30s
  const MAX_OTP_ATTEMPTS = 5;
  const OTP_LOCKOUT_MS = 30_000;
  const [otpAttempts, setOtpAttempts] = useState(0);
  const [otpLockedUntil, setOtpLockedUntil] = useState(0);
  // Refs
  const otpInputRef = useRef<TextInput>(null);
  const phoneInputRef = useRef<TextInput>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Full phone in E.164 format
  const fullPhone = `${country.dial}${phoneNumber.replace(/\D/g, "")}`;
  const canSend = phoneNumber.replace(/\D/g, "").length >= 6;

  // Resend countdown timer
  useEffect(() => {
    if (resendTimer <= 0) return;
    const interval = setInterval(() => {
      setResendTimer((t) => t - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [resendTimer]);

  // Cleanup focus timer on unmount
  useEffect(() => {
    return () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    };
  }, []);

  const handleSendCode = async () => {
    if (sendingRef.current || !canSend) return;
    sendingRef.current = true;
    impactMedium();
    setSending(true);

    const { success, error } = await sendPhoneOtp(fullPhone);

    setSending(false);
    sendingRef.current = false;

    if (success) {
      setStep("otp");
      setOtpCode("");
      setResendTimer(RESEND_COOLDOWN_SECONDS);
      focusTimerRef.current = setTimeout(() => otpInputRef.current?.focus(), 300);
    } else if (error) {
      Alert.alert(t("phoneLogin.couldntSendCode"), error);
    }
  };

  const handleVerifyCode = async () => {
    if (verifyingRef.current || otpCode.length !== OTP_LENGTH) return;
    if (Date.now() < otpLockedUntil) return;
    verifyingRef.current = true;
    impactMedium();
    setVerifying(true);

    try {
      const { success, error } = await verifyPhoneOtp(fullPhone, otpCode);

      if (success) {
        const routed = await fetchAndRoute(router);
        if (!routed) {
          router.replace("/");
        }
        return;
      } else {
        const nextAttempts = otpAttempts + 1;
        setOtpAttempts(nextAttempts);
        if (nextAttempts >= MAX_OTP_ATTEMPTS) {
          setOtpLockedUntil(Date.now() + OTP_LOCKOUT_MS);
          setOtpAttempts(0);
          Alert.alert(t("phoneLogin.verificationFailed"), t("phoneLogin.tooManyAttempts"));
        } else if (error) {
          Alert.alert(t("phoneLogin.verificationFailed"), error);
        }
        setOtpCode("");
      }
    } catch {
      Alert.alert(t("phoneLogin.verificationFailed"), t("common.somethingWentWrong"));
    } finally {
      setVerifying(false);
      verifyingRef.current = false;
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0 || sendingRef.current) return;
    sendingRef.current = true;
    impactLight();
    setSending(true);

    const { success, error } = await sendPhoneOtp(fullPhone);

    setSending(false);
    sendingRef.current = false;

    if (success) {
      setResendTimer(RESEND_COOLDOWN_SECONDS);
      setOtpCode("");
    } else if (error) {
      Alert.alert(t("phoneLogin.couldntResend"), error);
    }
  };

  const handleBack = () => {
    if (step === "otp") {
      setStep("phone");
      setOtpCode("");
      setResendTimer(0);
    } else {
      router.back();
    }
  };

  // Filter countries for search (matches both English name and localized name)
  const filteredCountries = countrySearch
    ? COUNTRIES.filter(
        (c) => {
          const query = countrySearch.toLowerCase();
          const localizedName = getLocalizedCountryName(c.code, c.name);
          return (
            c.name.toLowerCase().includes(query) ||
            localizedName.toLowerCase().includes(query) ||
            c.dial.includes(countrySearch)
          );
        },
      )
    : COUNTRIES;

  const selectCountry = useCallback((c: Country) => {
    impactLight();
    setCountry(c);
    setShowCountryPicker(false);
    setCountrySearch("");
    phoneInputRef.current?.focus();
  }, []);

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-wave-bg"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View
        className="flex-1 px-8"
        style={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }}
      >
        {/* Back button */}
        <TouchableOpacity
          onPress={handleBack}
          className="w-10 h-10 rounded-full bg-wave-surface items-center justify-center mb-8"
          accessibilityLabel={t("phoneLogin.goBack")}
          accessibilityRole="button"
        >
          <Ionicons name="arrow-back" size={20} color={COLORS.text} />
        </TouchableOpacity>

        {/* Content — centered */}
        <View className="flex-1 justify-center">
          {step === "phone" ? (
            <>
              {/* Phone input step */}
              <View className="w-12 h-12 rounded-full bg-wave-surface items-center justify-center mb-6 self-center">
                <Ionicons name="call-outline" size={24} color={COLORS.primary} />
              </View>

              <Text className="text-2xl font-bold text-white mb-2 text-center">
                {t("phoneLogin.yourPhoneNumber")}
              </Text>
              <Text className="text-wave-muted text-sm text-center mb-8 leading-5">
                {t("phoneLogin.sendCodeDescription")}
              </Text>

              {/* Phone input row */}
              <View className="flex-row mb-6" style={{ gap: 8 }}>
                {/* Country picker button */}
                <TouchableOpacity
                  onPress={() => setShowCountryPicker(true)}
                  className="bg-wave-surface rounded-2xl px-4 flex-row items-center justify-center"
                  style={{ height: 52 }}
                  accessibilityLabel={t("phoneLogin.countryCode", { dial: country.dial })}
                  accessibilityRole="button"
                >
                  <Text className="text-xl mr-1.5">{country.flag}</Text>
                  <Text className="text-white text-base font-semibold">{country.dial}</Text>
                  <Ionicons name="chevron-down" size={14} color={COLORS.muted} style={{ marginLeft: 4 }} />
                </TouchableOpacity>

                {/* Phone number input */}
                <View className="flex-1 bg-wave-surface rounded-2xl px-4 flex-row items-center" style={{ height: 52 }}>
                  <TextInput
                    ref={phoneInputRef}
                    value={phoneNumber}
                    onChangeText={setPhoneNumber}
                    placeholder={t("phoneLogin.phoneNumber")}
                    placeholderTextColor={COLORS.placeholder}
                    keyboardType="phone-pad"
                    autoFocus
                    className="flex-1 text-white text-base"
                    style={{ lineHeight: 20, paddingVertical: 0 }}
                    returnKeyType="done"
                    onSubmitEditing={handleSendCode}
                  />
                </View>
              </View>

              {/* Send code button */}
              <TouchableOpacity
                onPress={handleSendCode}
                disabled={sending || !canSend}
                className={`w-full rounded-2xl py-4 items-center justify-center ${
                  canSend ? "bg-wave-primary" : "bg-wave-surface"
                }`}
                activeOpacity={0.8}
                accessibilityLabel={t("phoneLogin.sendVerificationCode")}
                accessibilityRole="button"
              >
                {sending ? (
                  <ActivityIndicator color={COLORS.white} size="small" />
                ) : (
                  <Text className={`text-base font-semibold ${canSend ? "text-white" : "text-wave-muted"}`}>
                    {t("phoneLogin.sendCode")}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* OTP verification step */}
              <View className="w-12 h-12 rounded-full bg-wave-surface items-center justify-center mb-6 self-center">
                <Ionicons name="shield-checkmark-outline" size={24} color={COLORS.primary} />
              </View>

              <Text className="text-2xl font-bold text-white mb-2 text-center">
                {t("phoneLogin.enterCode")}
              </Text>
              <Text className="text-wave-muted text-sm text-center mb-8 leading-5">
                {t("phoneLogin.sentTo", { flag: country.flag, dial: country.dial, number: phoneNumber })}
              </Text>

              {/* OTP input */}
              <View className="w-full bg-wave-surface rounded-2xl px-4 flex-row items-center justify-center mb-4" style={{ height: 56 }}>
                <TextInput
                  ref={otpInputRef}
                  value={otpCode}
                  onChangeText={(text) => {
                    const digits = text.replace(/\D/g, "").slice(0, OTP_LENGTH);
                    setOtpCode(digits);
                  }}
                  placeholder="000000"
                  placeholderTextColor={COLORS.placeholder}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  maxLength={OTP_LENGTH}
                  className="text-white text-2xl font-bold text-center flex-1"
                  style={{ letterSpacing: 12, paddingVertical: 0 }}
                  autoFocus
                />
              </View>

              {/* Verify button */}
              <TouchableOpacity
                onPress={handleVerifyCode}
                disabled={verifying || otpCode.length !== OTP_LENGTH}
                className={`w-full rounded-2xl py-4 items-center justify-center mb-4 ${
                  otpCode.length === OTP_LENGTH ? "bg-wave-primary" : "bg-wave-surface"
                }`}
                activeOpacity={0.8}
                accessibilityLabel={t("phoneLogin.verifyCode")}
                accessibilityRole="button"
              >
                {verifying ? (
                  <ActivityIndicator color={COLORS.white} size="small" />
                ) : (
                  <Text className={`text-base font-semibold ${
                    otpCode.length === OTP_LENGTH ? "text-white" : "text-wave-muted"
                  }`}>
                    {t("phoneLogin.verify")}
                  </Text>
                )}
              </TouchableOpacity>

              {/* Resend */}
              <TouchableOpacity
                onPress={handleResend}
                disabled={resendTimer > 0 || sending}
                className="items-center py-2"
                accessibilityLabel={resendTimer > 0 ? t("phoneLogin.resendCodeAccessibility", { seconds: resendTimer }) : t("phoneLogin.resendCode")}
                accessibilityRole="button"
              >
                <Text className={`text-sm ${resendTimer > 0 ? "text-wave-muted" : "text-wave-primary font-semibold"}`}>
                  {resendTimer > 0
                    ? t("phoneLogin.resendIn", { seconds: resendTimer })
                    : sending
                      ? t("phoneLogin.sending")
                      : t("phoneLogin.resendCode")}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <Text className="text-wave-muted text-xs text-center leading-5">
          {t("common.identityHidden")}
        </Text>
      </View>

      {/* Country picker modal */}
      <Modal visible={showCountryPicker} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-wave-bg" style={{ paddingTop: insets.top }}>
          {/* Header */}
          <View className="flex-row items-center px-4 py-3 border-b border-wave-surface">
            <TouchableOpacity
              onPress={() => { setShowCountryPicker(false); setCountrySearch(""); }}
              className="mr-3"
              accessibilityLabel={t("phoneLogin.closeCountryPicker")}
              accessibilityRole="button"
            >
              <Ionicons name="close" size={24} color={COLORS.text} />
            </TouchableOpacity>
            <View className="flex-1 bg-wave-surface rounded-xl px-3 flex-row items-center" style={{ height: 40 }}>
              <Ionicons name="search" size={18} color={COLORS.muted} style={{ marginRight: 8 }} />
              <TextInput
                value={countrySearch}
                onChangeText={setCountrySearch}
                placeholder={t("phoneLogin.searchCountry")}
                placeholderTextColor={COLORS.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                className="flex-1 text-white text-sm"
                style={{ paddingVertical: 0 }}
              />
            </View>
          </View>

          {/* Country list */}
          <FlatList
            data={filteredCountries}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => selectCountry(item)}
                className="flex-row items-center px-4 py-3.5 border-b border-wave-surface/50"
                activeOpacity={0.7}
              >
                <Text className="text-xl mr-3">{item.flag}</Text>
                <Text className="text-white text-sm flex-1">{getLocalizedCountryName(item.code, item.name)}</Text>
                <Text className="text-wave-muted text-sm">{item.dial}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View className="items-center mt-8">
                <Text className="text-wave-muted text-sm">{t("phoneLogin.noCountries")}</Text>
              </View>
            }
          />
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}
