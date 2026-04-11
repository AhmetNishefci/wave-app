import { useState, useCallback, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import * as Localization from "expo-localization";
import { BottomSheet } from "@/components/BottomSheet";
import { COUNTRIES, getCountryByCode, type Country } from "@/constants/countries";
import { sendPhoneLinkOtp, verifyPhoneLinkOtp } from "@/services/authLinking";
import { COLORS } from "@/constants/colors";
import type { ToastVariant } from "@/components/Toast";

type Props = {
  visible: boolean;
  onClose: () => void;
  onLinked: () => void;
  showToast: (msg: string, variant?: ToastVariant) => void;
};

export function PhoneLinkSheet({ visible, onClose, onLinked, showToast }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"phone" | "otp" | "country">("phone");
  const [country, setCountry] = useState<Country>(() => {
    const region = Localization.getLocales()?.[0]?.regionCode;
    return region ? getCountryByCode(region) : getCountryByCode("US");
  });
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");

  // Reset form when sheet opens
  useEffect(() => {
    if (visible) {
      setStep("phone");
      setPhoneNumber("");
      setOtp("");
    }
  }, [visible]);

  const handleClose = useCallback(() => {
    onClose();
    setStep("phone");
    setCountrySearch("");
  }, [onClose]);

  const handleSendCode = async () => {
    if (loading || phoneNumber.length < 6) return;
    setLoading(true);
    const fullPhone = `${country.dial}${phoneNumber.replace(/\D/g, "")}`;
    const result = await sendPhoneLinkOtp(fullPhone);
    setLoading(false);
    if (result.success) {
      setStep("otp");
    } else if (result.error === "rate_limited") {
      showToast(t("phoneLogin.rateLimited"), "error");
    } else {
      showToast(result.error ?? t("settings.linkFailed"), "error");
    }
  };

  const handleVerify = async () => {
    if (loading || otp.length < 6) return;
    setLoading(true);
    const fullPhone = `${country.dial}${phoneNumber.replace(/\D/g, "")}`;
    const result = await verifyPhoneLinkOtp(fullPhone, otp);
    setLoading(false);
    if (result.success) {
      handleClose();
      onLinked();
      showToast(t("settings.identityLinked"));
    } else if (result.error === "expired") {
      showToast(t("auth.codeExpired"), "error");
    } else if (result.error === "invalid_code") {
      showToast(t("auth.invalidCode"), "error");
    } else {
      showToast(t("settings.linkFailed"), "error");
    }
  };

  return (
    <BottomSheet visible={visible} onClose={handleClose}>
      {step === "country" ? (
        <View style={{ maxHeight: 400 }}>
          {/* Country picker header */}
          <View className="flex-row items-center mb-3">
            <TouchableOpacity onPress={() => { setStep("phone"); setCountrySearch(""); }} className="mr-3">
              <Ionicons name="arrow-back" size={22} color={COLORS.text} />
            </TouchableOpacity>
            <View className="flex-1 bg-wave-surface rounded-xl px-3 flex-row items-center" style={{ height: 40 }}>
              <Ionicons name="search" size={16} color={COLORS.muted} style={{ marginRight: 8 }} />
              <TextInput
                value={countrySearch}
                onChangeText={setCountrySearch}
                placeholder={t("phoneLogin.searchCountry")}
                placeholderTextColor={COLORS.muted}
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
            data={COUNTRIES.filter((c) => {
              if (!countrySearch) return true;
              const q = countrySearch.toLowerCase();
              return c.name.toLowerCase().includes(q) || c.dial.includes(q);
            })}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => {
                  setCountry(item);
                  setStep("phone");
                  setCountrySearch("");
                }}
                className="flex-row items-center py-3 border-b border-wave-surface/50"
                activeOpacity={0.7}
              >
                <Text className="text-xl mr-3">{item.flag}</Text>
                <Text className="text-white text-sm flex-1">{item.name}</Text>
                <Text className="text-wave-muted text-sm">{item.dial}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      ) : (
        <>
          <View className="items-center mb-4">
            <Ionicons name="call-outline" size={28} color={COLORS.primary} style={{ marginBottom: 8 }} />
            <Text className="text-white text-lg font-semibold">
              {step === "phone" ? t("settings.linkPhone") : t("settings.verifyCode")}
            </Text>
          </View>

          {step === "phone" ? (
            <View>
              <View className="flex-row items-center bg-wave-surface rounded-xl px-4 py-3 mb-4">
                <TouchableOpacity
                  onPress={() => setStep("country")}
                  className="mr-3 flex-row items-center"
                >
                  <Text className="text-white text-base">{country.flag} {country.dial}</Text>
                  <Ionicons name="chevron-down" size={12} color={COLORS.muted} style={{ marginLeft: 4 }} />
                </TouchableOpacity>
                <TextInput
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  placeholder={t("phoneLogin.phoneNumber")}
                  placeholderTextColor={COLORS.muted}
                  keyboardType="phone-pad"
                  className="flex-1 text-white text-base"
                  autoFocus
                />
              </View>
              <TouchableOpacity
                onPress={handleSendCode}
                disabled={loading || phoneNumber.length < 6}
                className={`w-full rounded-xl py-3.5 items-center ${
                  phoneNumber.length >= 6 ? "bg-wave-primary" : "bg-wave-surface"
                }`}
              >
                {loading ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <Text className={`font-semibold ${phoneNumber.length >= 6 ? "text-white" : "text-wave-muted"}`}>
                    {t("phoneLogin.sendCode")}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <TextInput
                value={otp}
                onChangeText={(text) => setOtp(text.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                placeholderTextColor={COLORS.muted}
                keyboardType="number-pad"
                className="text-white text-2xl text-center tracking-[12px] bg-wave-surface rounded-xl px-4 py-3 mb-4"
                autoFocus
                maxLength={6}
              />
              <TouchableOpacity
                onPress={handleVerify}
                disabled={loading || otp.length < 6}
                className={`w-full rounded-xl py-3.5 items-center ${
                  otp.length >= 6 ? "bg-wave-primary" : "bg-wave-surface"
                }`}
              >
                {loading ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <Text className={`font-semibold ${otp.length >= 6 ? "text-white" : "text-wave-muted"}`}>
                    {t("settings.verifyAndLink")}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </BottomSheet>
  );
}
