import { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, Linking, TextInput, Switch, RefreshControl, Platform, FlatList } from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useBleStore } from "@/stores/bleStore";
import { useWaveStore } from "@/stores/waveStore";
import { useTokenStore } from "@/stores/tokenStore";
import { useMatchStore } from "@/stores/matchStore";
import { useAuthStore } from "@/stores/authStore";
import { signOut } from "@/services/auth";
import {
  getLinkedIdentities,
  linkGoogleIdentity,
  linkAppleIdentity,
  sendPhoneLinkOtp,
  verifyPhoneLinkOtp,
  unlinkIdentity,
  type LinkedIdentity,
  type AuthProvider,
} from "@/services/authLinking";
import { COUNTRIES, getCountryByCode, type Country } from "@/constants/countries";
import * as Localization from "expo-localization";
import { saveInstagramHandle, saveSnapchatHandle, updateGenderPreference, updateAgePreference, saveNote, saveNearbyAlertsPreference, saveDailyPushesPreference, syncLocaleToServer } from "@/services/profile";
import { getBlockedUsers, unblockUser } from "@/services/wave/waves";
import { getFakeBlockedUsers } from "@/utils/seedPeers";
import { requestLocationPermission, hasLocationPermission, isLocationBlocked, resetLocationCache } from "@/services/location";
import { supabase } from "@/services/supabase";
import { waveBleManager } from "@/services/ble/bleManager";
import { impactLight } from "@/utils/haptics";
import { Toast, type ToastVariant } from "@/components/Toast";
import { AgeRangeSlider } from "@/components/AgeRangeSlider";
import { BottomSheet } from "@/components/BottomSheet";
import { COLORS } from "@/constants/colors";
import { getAgeFromDob } from "@/utils/age";
import i18n, { changeAppLanguage, resetToDeviceLanguage } from "@/i18n";
import type { GenderPreference } from "@/types";

const LANGUAGES = [
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
  { code: "pt", name: "Portuguese", flag: "🇵🇹" },
  { code: "tr", name: "Turkish", flag: "🇹🇷" },
];

const PREFERENCE_OPTIONS: { value: GenderPreference; labelKey: string }[] = [
  { value: "male", labelKey: "gender.men" },
  { value: "female", labelKey: "gender.women" },
  { value: "both", labelKey: "gender.everyone" },
];

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { session, dateOfBirth, instagramHandle, setInstagramHandle, snapchatHandle, setSnapchatHandle, gender, genderPreference, setGenderPreference, agePreferenceMin, agePreferenceMax, setAgePreference, note, setNote, nearbyAlertsEnabled, setNearbyAlertsEnabled, dailyPushesEnabled, setDailyPushesEnabled } = useAuthStore();
  const totalMatches = useMatchStore((s) => s.matchesById.size);
  const rawEmail = session?.user?.email ?? null;
  const userEmail = rawEmail?.includes("privaterelay.appleid.com")
    ? t("settings.hiddenApple")
    : rawEmail;
  const userPhone = session?.user?.phone ?? null;
  const router = useRouter();

  const [deleting, setDeleting] = useState(false);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [showBlockedUsers, setShowBlockedUsers] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<{ blockedId: string; displayName: string | null; createdAt: string }[]>([]);
  const [loadingBlocked, setLoadingBlocked] = useState(false);
  const [unblockTarget, setUnblockTarget] = useState<{ blockedId: string; displayName: string | null } | null>(null);
  const [unblocking, setUnblocking] = useState(false);
  const [blockedSearch, setBlockedSearch] = useState("");
  const [showSupport, setShowSupport] = useState(false);
  const [supportCategory, setSupportCategory] = useState<string | null>(null);
  const [supportDetails, setSupportDetails] = useState("");
  const [submittingTicket, setSubmittingTicket] = useState(false);
  const [ticketConfirmed, setTicketConfirmed] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastVariant, setToastVariant] = useState<ToastVariant>("success");
  // Linked accounts state
  const [linkedIdentities, setLinkedIdentities] = useState<LinkedIdentity[]>([]);
  const [linkingProvider, setLinkingProvider] = useState<AuthProvider | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  // Phone linking bottom sheet state
  const [showPhoneLink, setShowPhoneLink] = useState(false);
  const [phoneLinkStep, setPhoneLinkStep] = useState<"phone" | "otp" | "country">("phone");
  const [phoneLinkCountry, setPhoneLinkCountry] = useState<Country>(() => {
    const region = Localization.getLocales()?.[0]?.regionCode;
    return region ? getCountryByCode(region) : getCountryByCode("US");
  });
  const [phoneLinkNumber, setPhoneLinkNumber] = useState("");
  const [phoneLinkOtp, setPhoneLinkOtp] = useState("");
  const [phoneLinkLoading, setPhoneLinkLoading] = useState(false);
  const [phoneLinkCountrySearch, setPhoneLinkCountrySearch] = useState("");

  useEffect(() => {
    getLinkedIdentities().then(setLinkedIdentities);
  }, []);

  const handleLinkProvider = async (provider: AuthProvider) => {
    if (linkingProvider) return;
    setLinkingProvider(provider);

    let result;
    if (provider === "google") {
      result = await linkGoogleIdentity();
    } else if (provider === "apple") {
      result = await linkAppleIdentity();
    } else if (provider === "phone") {
      setLinkingProvider(null);
      setPhoneLinkStep("phone");
      setPhoneLinkNumber("");
      setPhoneLinkOtp("");
      setShowPhoneLink(true);
      return;
    } else {
      setLinkingProvider(null);
      return;
    }

    setLinkingProvider(null);

    if (result.success) {
      const updated = await getLinkedIdentities();
      setLinkedIdentities(updated);
      showToast(t("settings.identityLinked"));
    } else if (result.error === "cancelled") {
      // user dismissed — no toast
    } else if (result.error === "identity_exists") {
      showToast(t("settings.identityAlreadyUsed"), "error");
    } else if (result.error === "already_linked") {
      showToast(t("settings.identityAlreadyLinked"), "error");
    } else {
      showToast(t("settings.linkFailed"), "error");
    }
  };

  const handleUnlinkIdentity = (identity: LinkedIdentity) => {
    if (linkedIdentities.length <= 1) {
      showToast(t("settings.cantUnlinkLast"), "error");
      return;
    }

    const providerName = identity.provider === "apple" ? "Apple" : identity.provider === "google" ? "Google" : t("login.phone");

    Alert.alert(
      t("settings.unlinkTitle"),
      t("settings.unlinkMessage", { provider: providerName }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("settings.unlink"),
          style: "destructive",
          onPress: async () => {
            setUnlinkingId(identity.id);
            const result = await unlinkIdentity(identity.id);
            setUnlinkingId(null);
            if (result.success) {
              const updated = await getLinkedIdentities();
              setLinkedIdentities(updated);
              showToast(t("settings.identityUnlinked"));
            } else {
              showToast(result.error ?? t("settings.unlinkFailed"), "error");
            }
          },
        },
      ],
    );
  };

  const handlePhoneLinkSendCode = async () => {
    if (phoneLinkLoading || phoneLinkNumber.length < 6) return;
    setPhoneLinkLoading(true);
    const fullPhone = `${phoneLinkCountry.dial}${phoneLinkNumber.replace(/\D/g, "")}`;
    const result = await sendPhoneLinkOtp(fullPhone);
    setPhoneLinkLoading(false);
    if (result.success) {
      setPhoneLinkStep("otp");
    } else if (result.error === "rate_limited") {
      showToast(t("phoneLogin.rateLimited"), "error");
    } else {
      showToast(result.error ?? t("settings.linkFailed"), "error");
    }
  };

  const handlePhoneLinkVerify = async () => {
    if (phoneLinkLoading || phoneLinkOtp.length < 6) return;
    setPhoneLinkLoading(true);
    const fullPhone = `${phoneLinkCountry.dial}${phoneLinkNumber.replace(/\D/g, "")}`;
    const result = await verifyPhoneLinkOtp(fullPhone, phoneLinkOtp);
    setPhoneLinkLoading(false);
    if (result.success) {
      setShowPhoneLink(false);
      const updated = await getLinkedIdentities();
      setLinkedIdentities(updated);
      showToast(t("settings.identityLinked"));
    } else if (result.error === "expired") {
      showToast(t("auth.codeExpired"), "error");
    } else if (result.error === "invalid_code") {
      showToast(t("auth.invalidCode"), "error");
    } else {
      showToast(t("settings.linkFailed"), "error");
    }
  };

  const langCode = i18n.language?.substring(0, 2) ?? "en";
  const currentLang = LANGUAGES.find((l) => l.code === langCode) ?? LANGUAGES[0];

  const showToast = useCallback((msg: string, variant: ToastVariant = "success") => {
    setToastVariant(variant);
    setToastMessage(msg);
  }, []);

  // Load blocked users when the sheet opens
  const openBlockedUsers = useCallback(() => {
    setUnblockTarget(null);
    setBlockedSearch("");
    setLoadingBlocked(true);
    setShowBlockedUsers(true);
    getBlockedUsers().then((users) => {
      setBlockedUsers(users.length > 0 || !__DEV__ ? users : getFakeBlockedUsers());
      setLoadingBlocked(false);
    }).catch(() => {
      setLoadingBlocked(false);
      showToast(t("settings.genericError"), "error");
    });
  }, [showToast, t]);

  const handleUnblock = (blockedId: string, displayName: string | null) => {
    setUnblockTarget({ blockedId, displayName });
  };

  const confirmUnblock = async () => {
    if (!unblockTarget) return;
    setUnblocking(true);
    const success = await unblockUser(unblockTarget.blockedId);
    setUnblocking(false);
    if (success) {
      setBlockedUsers((prev) => prev.filter((u) => u.blockedId !== unblockTarget.blockedId));
      useBleStore.getState().removeBlockedUserId(unblockTarget.blockedId);
      // Evict stale peer entries so BLE rediscovery creates fresh ones.
      // useNoteResolver's subscriber detects new unresolved tokens and
      // triggers a fast resolution tick (~1s), making the peer reappear
      // on radar within seconds instead of waiting up to 60s.
      useBleStore.getState().removeByUserId(unblockTarget.blockedId);
      setUnblockTarget(null);
      showToast(t("settings.unblocked"));
    } else {
      showToast(t("settings.unblockError"), "error");
    }
  };

  const handleSubmitTicket = async () => {
    if (!supportCategory) return;
    setSubmittingTicket(true);
    setTicketError(null);
    try {
      // Store ticket in DB (rate limited, structured, auditable)
      const { error } = await supabase.rpc("create_support_ticket", {
        p_category: supportCategory,
        p_details: supportDetails.trim() || null,
      });
      if (error) {
        setSubmittingTicket(false);
        const isRateLimited = error.message?.includes("rate_limited");
        setTicketError(isRateLimited ? t("settings.ticketRateLimited") : t("settings.ticketError"));
        return;
      }

      // Send email notification (non-blocking — ticket is saved even if email fails)
      supabase.functions.invoke("send-support-email", {
        body: {
          category: supportCategory,
          details: supportDetails.trim() || null,
          device: {
            appVersion: Constants.expoConfig?.version ?? "unknown",
            platform: Platform.OS,
            osVersion: Platform.Version,
            deviceName: Constants.deviceName ?? "unknown",
          },
        },
      }).catch(() => {
        // Email failed silently — ticket is still in DB
      });

      setSubmittingTicket(false);
      setTicketConfirmed(true);
    } catch {
      setSubmittingTicket(false);
      setTicketError(t("settings.ticketError"));
    }
  };

  const handleChangeLanguage = (code: string) => {
    impactLight();
    changeAppLanguage(code);
    syncLocaleToServer(code);
    setShowLanguagePicker(false);
  };

  const handleResetLanguage = () => {
    impactLight();
    resetToDeviceLanguage().then(() => {
      const deviceLang = i18n.language;
      syncLocaleToServer(deviceLang);
    }).catch(() => {
      showToast(t("settings.genericError"), "error");
    });
    setShowLanguagePicker(false);
  };
  const [editingHandle, setEditingHandle] = useState(false);
  const [handleInput, setHandleInput] = useState(instagramHandle ?? "");
  const [savingHandle, setSavingHandle] = useState(false);
  const [editingSnapchat, setEditingSnapchat] = useState(false);
  const [snapchatInput, setSnapchatInput] = useState(snapchatHandle ?? "");
  const [savingSnapchat, setSavingSnapchat] = useState(false);
  const [savingPreference, setSavingPreference] = useState(false);
  const [savingAgePref, setSavingAgePref] = useState(false);
  const ageSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [noteInput, setNoteInput] = useState(note ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const [savingAlerts, setSavingAlerts] = useState(false);
  const [savingDailyPushes, setSavingDailyPushes] = useState(false);
  // Clean up debounce timer on unmount to avoid state updates on unmounted component
  useEffect(() => {
    return () => {
      if (ageSaveTimer.current) clearTimeout(ageSaveTimer.current);
    };
  }, []);

  const handleSaveHandle = async () => {
    const trimmed = handleInput.trim().replace(/^@/, "");
    if (!trimmed) return;

    impactLight();
    setSavingHandle(true);

    const result = await saveInstagramHandle(trimmed);
    setSavingHandle(false);

    if (result.handle) {
      setInstagramHandle(result.handle);
      setEditingHandle(false);
      showToast(t("settings.usernameUpdated"));
    } else if (result.error === "taken") {
      showToast(t("settings.usernameTaken"), "error");
    } else {
      showToast(t("settings.instagramInvalid"), "error");
    }
  };

  const handleSaveSnapchat = async () => {
    const trimmed = snapchatInput.trim().replace(/^@/, "");
    if (!trimmed) return;

    impactLight();
    setSavingSnapchat(true);

    const result = await saveSnapchatHandle(trimmed);
    setSavingSnapchat(false);

    if (result.handle) {
      setSnapchatHandle(result.handle);
      setEditingSnapchat(false);
      showToast(t("settings.snapchatUpdated"));
    } else if (result.error === "taken") {
      showToast(t("settings.snapchatTaken"), "error");
    } else {
      showToast(t("settings.snapchatInvalid"), "error");
    }
  };

  const handlePreferenceChange = async (pref: GenderPreference) => {
    if (pref === genderPreference || savingPreference) return;

    impactLight();
    setSavingPreference(true);

    const success = await updateGenderPreference(pref);
    setSavingPreference(false);

    if (success) {
      setGenderPreference(pref);
      const label = PREFERENCE_OPTIONS.find((o) => o.value === pref);
      showToast(t("settings.nowShowing", { label: label ? t(label.labelKey).toLowerCase() : pref }));
    } else {
      showToast(t("settings.preferenceError"), "error");
    }
  };

  // Debounced save: update store immediately, persist to server after 500ms
  const handleAgePreferenceChange = useCallback((min: number, max: number) => {
    setAgePreference(min, max);
    if (ageSaveTimer.current) clearTimeout(ageSaveTimer.current);
    ageSaveTimer.current = setTimeout(async () => {
      setSavingAgePref(true);
      const success = await updateAgePreference(min, max);
      setSavingAgePref(false);
      if (success) {
        showToast(t("settings.ageRangeUpdated", { min, max }));
      } else {
        showToast(t("settings.ageRangeError"), "error");
      }
    }, 500);
  }, [setAgePreference, showToast]);

  const handleToggleAlerts = async (enabled: boolean) => {
    if (savingAlerts) return;
    setSavingAlerts(true);

    // When enabling, ensure location permission is granted
    if (enabled) {
      const alreadyGranted = await hasLocationPermission();
      if (!alreadyGranted) {
        const blocked = await isLocationBlocked();
        if (blocked) {
          setSavingAlerts(false);
          Alert.alert(
            t("settings.locationNeeded"),
            t("settings.locationDenied"),
            [
              { text: t("common.cancel"), style: "cancel" },
              { text: t("common.openSettings"), onPress: () => Linking.openSettings() },
            ],
          );
          return;
        }

        const permResult = await requestLocationPermission();
        if (permResult !== "granted") {
          setSavingAlerts(false);
          showToast(t("settings.locationRequired"), "error");
          return;
        }
      }
    }

    const success = await saveNearbyAlertsPreference(enabled);
    setSavingAlerts(false);

    if (success) {
      setNearbyAlertsEnabled(enabled);
      showToast(enabled ? t("settings.alertsEnabled") : t("settings.alertsDisabled"));
    } else {
      showToast(t("settings.alertsError"), "error");
    }
  };

  const handleToggleDailyPushes = async (enabled: boolean) => {
    if (savingDailyPushes) return;
    setSavingDailyPushes(true);

    const success = await saveDailyPushesPreference(enabled);
    setSavingDailyPushes(false);

    if (success) {
      setDailyPushesEnabled(enabled);
      showToast(enabled ? t("settings.remindersEnabled") : t("settings.remindersDisabled"));
    } else {
      showToast(t("settings.preferenceError"), "error");
    }
  };

  const handleSaveNote = async () => {
    const trimmed = noteInput.trim();
    impactLight();
    setSavingNote(true);

    const success = await saveNote(trimmed || null);
    setSavingNote(false);

    if (success) {
      setNote(trimmed || null);
      setEditingNote(false);
      showToast(trimmed ? t("settings.noteUpdated") : t("settings.noteCleared"));
    } else {
      showToast(t("settings.noteError"), "error");
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t("settings.deleteAccount"),
      t("settings.deleteConfirm"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              // Use getUser() to validate the token, not cached getSession() (H14 fix)
              const { data: { user }, error: userError } = await supabase.auth.getUser();
              if (userError || !user) {
                setDeleting(false);
                showToast(t("settings.notSignedIn"), "error");
                return;
              }
              const { data: { session } } = await supabase.auth.getSession();
              if (!session) {
                setDeleting(false);
                showToast(t("settings.sessionExpired"), "error");
                return;
              }

              const { error } = await supabase.functions.invoke("delete-account", {
                headers: { Authorization: `Bearer ${session.access_token}` },
              });

              if (error) {
                setDeleting(false);
                showToast(t("settings.deleteError"), "error");
                return;
              }

              // Clean up local state + module caches
              await waveBleManager.stop();
              resetLocationCache();
              useWaveStore.getState().reset();
              useTokenStore.getState().reset();
              useMatchStore.getState().reset();
              useBleStore.getState().reset();
              useAuthStore.getState().reset();
              await supabase.auth.signOut();
              router.replace("/");
            } catch {
              setDeleting(false);
              showToast(t("settings.genericError"), "error");
            }
          },
        },
      ],
    );
  };

  return (
    <>
      {/* Phone linking bottom sheet */}
      <BottomSheet visible={showPhoneLink} onClose={() => { setShowPhoneLink(false); setPhoneLinkStep("phone"); setPhoneLinkCountrySearch(""); }}>
        {phoneLinkStep === "country" ? (
          <View style={{ maxHeight: 400 }}>
            {/* Country picker header */}
            <View className="flex-row items-center mb-3">
              <TouchableOpacity onPress={() => { setPhoneLinkStep("phone"); setPhoneLinkCountrySearch(""); }} className="mr-3">
                <Ionicons name="arrow-back" size={22} color={COLORS.text} />
              </TouchableOpacity>
              <View className="flex-1 bg-wave-surface rounded-xl px-3 flex-row items-center" style={{ height: 40 }}>
                <Ionicons name="search" size={16} color={COLORS.muted} style={{ marginRight: 8 }} />
                <TextInput
                  value={phoneLinkCountrySearch}
                  onChangeText={setPhoneLinkCountrySearch}
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
                if (!phoneLinkCountrySearch) return true;
                const q = phoneLinkCountrySearch.toLowerCase();
                return c.name.toLowerCase().includes(q) || c.dial.includes(q);
              })}
              keyExtractor={(item) => item.code}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => {
                    setPhoneLinkCountry(item);
                    setPhoneLinkStep("phone");
                    setPhoneLinkCountrySearch("");
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
                {phoneLinkStep === "phone" ? t("settings.linkPhone") : t("settings.verifyCode")}
              </Text>
            </View>

            {phoneLinkStep === "phone" ? (
              <View>
                <View className="flex-row items-center bg-wave-surface rounded-xl px-4 py-3 mb-4">
                  <TouchableOpacity
                    onPress={() => setPhoneLinkStep("country")}
                    className="mr-3 flex-row items-center"
                  >
                    <Text className="text-white text-base">{phoneLinkCountry.flag} {phoneLinkCountry.dial}</Text>
                    <Ionicons name="chevron-down" size={12} color={COLORS.muted} style={{ marginLeft: 4 }} />
                  </TouchableOpacity>
                  <TextInput
                    value={phoneLinkNumber}
                    onChangeText={setPhoneLinkNumber}
                    placeholder={t("phoneLogin.phoneNumber")}
                    placeholderTextColor={COLORS.muted}
                    keyboardType="phone-pad"
                    className="flex-1 text-white text-base"
                    autoFocus
                  />
                </View>
                <TouchableOpacity
                  onPress={handlePhoneLinkSendCode}
                  disabled={phoneLinkLoading || phoneLinkNumber.length < 6}
                  className={`w-full rounded-xl py-3.5 items-center ${
                    phoneLinkNumber.length >= 6 ? "bg-wave-primary" : "bg-wave-surface"
                  }`}
                >
                  {phoneLinkLoading ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : (
                    <Text className={`font-semibold ${phoneLinkNumber.length >= 6 ? "text-white" : "text-wave-muted"}`}>
                      {t("phoneLogin.sendCode")}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                <TextInput
                  value={phoneLinkOtp}
                  onChangeText={(text) => setPhoneLinkOtp(text.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  placeholderTextColor={COLORS.muted}
                  keyboardType="number-pad"
                  className="text-white text-2xl text-center tracking-[12px] bg-wave-surface rounded-xl px-4 py-3 mb-4"
                  autoFocus
                  maxLength={6}
                />
                <TouchableOpacity
                  onPress={handlePhoneLinkVerify}
                  disabled={phoneLinkLoading || phoneLinkOtp.length < 6}
                  className={`w-full rounded-xl py-3.5 items-center ${
                    phoneLinkOtp.length >= 6 ? "bg-wave-primary" : "bg-wave-surface"
                  }`}
                >
                  {phoneLinkLoading ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : (
                    <Text className={`font-semibold ${phoneLinkOtp.length >= 6 ? "text-white" : "text-wave-muted"}`}>
                      {t("settings.verifyAndLink")}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </BottomSheet>

      {/* Full-screen blocking overlay while deleting */}
      <Modal visible={deleting} transparent animationType="fade">
        <View className="flex-1 bg-black/80 items-center justify-center">
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text className="text-white text-base mt-4">{t("settings.deletingAccount")}</Text>
        </View>
      </Modal>

    <ScrollView className="flex-1 bg-wave-bg pt-16 px-4">
      {/* Header */}
      <View className="mb-6">
        <Text className="text-3xl font-bold text-white">{t("settings.title")}</Text>
      </View>

      {/* Account */}
      <Section title={t("settings.account")}>
        {userEmail && (
          <InfoRow label={t("settings.email")} value={userEmail} />
        )}
        {userPhone && (
          <InfoRow label={t("settings.phone")} value={userPhone} />
        )}
        {gender && (
          <InfoRow label={t("settings.gender")} value={gender === "male" ? t("gender.male") : t("gender.female")} />
        )}
        {dateOfBirth && (
          <>
            <InfoRow label={t("settings.birthday")} value={formatDob(dateOfBirth)} />
            <InfoRow label={t("settings.age")} value={`${getAgeFromDob(dateOfBirth)}`} />
          </>
        )}
        {(gender || dateOfBirth) && (
          <Text className="text-wave-muted text-xs mt-2 leading-4">
            {t("settings.genderLocked")}
          </Text>
        )}
      </Section>

      {/* Linked Accounts */}
      <Section title={t("settings.linkedAccounts")}>
        {(["apple", "google", "phone"] as AuthProvider[]).map((provider) => {
          const identity = linkedIdentities.find((i) => i.provider === provider);
          const isLinked = !!identity;
          const isLinking = linkingProvider === provider;
          const isUnlinking = unlinkingId === identity?.id;
          const providerIcon = provider === "apple" ? "logo-apple" : provider === "google" ? "logo-google" : "call-outline";
          const providerName = provider === "apple" ? "Apple" : provider === "google" ? "Google" : t("login.phone");
          const detail = identity?.email
            ? identity.email.includes("privaterelay") ? t("settings.hiddenApple") : identity.email
            : identity?.phone ?? null;

          return (
            <View key={provider} className="flex-row items-center justify-between py-2.5">
              <View className="flex-row items-center flex-1">
                <Ionicons
                  name={providerIcon as any}
                  size={18}
                  color={isLinked ? COLORS.text : COLORS.muted}
                  style={{ marginRight: 10, width: 20 }}
                />
                <View className="flex-1">
                  <Text className={`text-sm ${isLinked ? "text-white" : "text-wave-muted"}`}>
                    {providerName}
                  </Text>
                  {detail && (
                    <Text className="text-wave-muted text-xs" numberOfLines={1}>{detail}</Text>
                  )}
                </View>
              </View>
              {isLinked ? (
                <View className="flex-row items-center" style={{ gap: 10 }}>
                  {linkedIdentities.length > 1 && (
                    <TouchableOpacity
                      onPress={() => handleUnlinkIdentity(identity)}
                      disabled={isUnlinking}
                    >
                      {isUnlinking ? (
                        <ActivityIndicator size="small" color={COLORS.muted} />
                      ) : (
                        <Text className="text-wave-muted text-xs">{t("settings.unlink")}</Text>
                      )}
                    </TouchableOpacity>
                  )}
                  <Ionicons name="checkmark-circle" size={18} color={COLORS.accent} />
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => handleLinkProvider(provider)}
                  disabled={isLinking}
                >
                  {isLinking ? (
                    <ActivityIndicator size="small" color={COLORS.primary} />
                  ) : (
                    <Text className="text-wave-primary text-xs font-semibold">{t("settings.link")}</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          );
        })}
        <Text className="text-wave-muted text-xs mt-2 leading-4">
          {t("settings.linkedAccountsHint")}
        </Text>
      </Section>

      {/* Language */}
      <Section title={t("common.language")}>
        <TouchableOpacity
          onPress={() => setShowLanguagePicker(true)}
          activeOpacity={0.7}
        >
          <View className="flex-row justify-between items-center py-1.5">
            <View className="flex-row items-center">
              <Text className="text-lg mr-2">{currentLang.flag}</Text>
              <Text className="text-white text-sm">{currentLang.name}</Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={COLORS.muted} />
          </View>
        </TouchableOpacity>
      </Section>

      {/* Stats */}
      <Section title={t("settings.stats")}>
        <InfoRow label={t("settings.totalMatches")} value={String(totalMatches)} />
      </Section>

      {/* Discovery Preference */}
      <Section title={t("settings.discovery")}>
        <Text className="text-wave-muted text-xs mb-3">{t("settings.showMe")}</Text>
        <View style={{ gap: 8 }}>
          {PREFERENCE_OPTIONS.map((option) => {
            const selected = genderPreference === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                onPress={() => handlePreferenceChange(option.value)}
                disabled={savingPreference}
                className={`rounded-xl py-3 px-4 flex-row items-center justify-between border ${
                  selected
                    ? "bg-wave-primary/20 border-wave-primary"
                    : "bg-wave-bg border-transparent"
                }`}
                activeOpacity={0.7}
              >
                <Text
                  className={`text-sm font-semibold ${
                    selected ? "text-white" : "text-wave-muted"
                  }`}
                >
                  {t(option.labelKey)}
                </Text>
                {selected && (
                  <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        {savingPreference && (
          <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: 8 }} />
        )}

        {/* Age Range */}
        <View className="mt-4 pt-4 border-t border-wave-bg">
          <Text className="text-wave-muted text-xs mb-3">{t("settings.ageRange")}</Text>
          <AgeRangeSlider
            min={agePreferenceMin ?? 18}
            max={agePreferenceMax ?? 80}
            onChangeEnd={handleAgePreferenceChange}
          />
          {savingAgePref && (
            <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: 8 }} />
          )}
        </View>

        <Text className="text-wave-muted text-xs mt-3 leading-4">
          {t("settings.discoveryHint")}
        </Text>
      </Section>

      {/* Nearby Alerts */}
      <Section title={t("settings.nearbyAlerts")}>
        <View className="flex-row items-center justify-between">
          <View className="flex-1 mr-4">
            <Text className="text-white text-sm font-semibold">{t("settings.nearbyAlerts")}</Text>
            <Text className="text-wave-muted text-xs mt-1 leading-4">
              {t("settings.nearbyAlertsSubtitle")}
            </Text>
          </View>
          <Switch
            value={nearbyAlertsEnabled}
            onValueChange={handleToggleAlerts}
            disabled={savingAlerts}
            trackColor={{ false: COLORS.switchOff, true: COLORS.primary }}
            thumbColor="white"
          />
        </View>
        {savingAlerts && (
          <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: 8 }} />
        )}
        <Text className="text-wave-muted text-xs mt-3 leading-4">
          {t("settings.nearbyAlertsHint")}
        </Text>
      </Section>

      {/* Daily Reminders */}
      <Section title={t("settings.dailyReminders")}>
        <View className="flex-row items-center justify-between">
          <View className="flex-1 mr-4">
            <Text className="text-white text-sm font-semibold">{t("settings.eveningReminders")}</Text>
            <Text className="text-wave-muted text-xs mt-1 leading-4">
              {t("settings.eveningRemindersSubtitle")}
            </Text>
          </View>
          <Switch
            value={dailyPushesEnabled}
            onValueChange={handleToggleDailyPushes}
            disabled={savingDailyPushes}
            trackColor={{ false: COLORS.switchOff, true: COLORS.primary }}
            thumbColor="white"
          />
        </View>
        {savingDailyPushes && (
          <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: 8 }} />
        )}
        <Text className="text-wave-muted text-xs mt-3 leading-4">
          {t("settings.eveningRemindersHint")}
        </Text>
      </Section>

      {/* Socials */}
      <Section title={t("settings.socials")}>
        {/* Instagram */}
        {editingHandle ? (
          <View className="mb-3">
            <View className="flex-row items-center mb-2">
              <Ionicons name="logo-instagram" size={14} color={COLORS.primary} />
              <Text className="text-wave-muted text-xs ml-1.5">{t("onboarding.instagram")}</Text>
            </View>
            <View className="bg-wave-bg rounded-xl flex-row items-center px-3" style={{ height: 44 }}>
              <Text className="text-wave-muted text-sm" style={{ lineHeight: 18 }}>@</Text>
              <TextInput
                value={handleInput}
                onChangeText={setHandleInput}
                placeholder={t("common.username")}
                placeholderTextColor={COLORS.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                className="flex-1 text-white text-sm ml-1"
                style={{ lineHeight: 18, paddingVertical: 0 }}
                autoFocus
                returnKeyType="done"
                maxLength={30}
                onSubmitEditing={handleSaveHandle}
              />
            </View>
            <View className="flex-row justify-end mt-2">
              <TouchableOpacity
                onPress={() => {
                  setEditingHandle(false);
                  setHandleInput(instagramHandle ?? "");
                }}
                className="rounded-lg px-4 py-2 mr-2"
              >
                <Text className="text-wave-muted text-sm">{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveHandle}
                disabled={savingHandle || !handleInput.trim()}
                className="bg-wave-primary rounded-lg px-4 py-2"
              >
                {savingHandle ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <Text className="text-white text-sm font-semibold">{t("common.save")}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setEditingHandle(true)} activeOpacity={0.7} className="mb-3">
            <View className="flex-row justify-between items-center py-1.5">
              <View className="flex-row items-center">
                <Ionicons name="logo-instagram" size={16} color={COLORS.primary} style={{ marginRight: 8 }} />
                <Text className="text-wave-muted text-sm">{t("onboarding.instagram")}</Text>
              </View>
              <View className="flex-row items-center">
                <Text className="text-white text-sm font-mono mr-2">
                  {instagramHandle ? `@${instagramHandle}` : t("common.notSet")}
                </Text>
                <Ionicons name="pencil" size={14} color={COLORS.primary} />
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* Divider */}
        <View className="h-px bg-wave-bg mb-3" />

        {/* Snapchat */}
        {editingSnapchat ? (
          <View>
            <View className="flex-row items-center mb-2">
              <Ionicons name="logo-snapchat" size={14} color={COLORS.snapchat} />
              <Text className="text-wave-muted text-xs ml-1.5">{t("onboarding.snapchat")}</Text>
            </View>
            <View className="bg-wave-bg rounded-xl flex-row items-center px-3" style={{ height: 44 }}>
              <TextInput
                value={snapchatInput}
                onChangeText={setSnapchatInput}
                placeholder={t("common.username")}
                placeholderTextColor={COLORS.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                className="flex-1 text-white text-sm"
                style={{ lineHeight: 18, paddingVertical: 0 }}
                autoFocus
                returnKeyType="done"
                maxLength={15}
                onSubmitEditing={handleSaveSnapchat}
              />
            </View>
            <View className="flex-row justify-end mt-2">
              <TouchableOpacity
                onPress={() => {
                  setEditingSnapchat(false);
                  setSnapchatInput(snapchatHandle ?? "");
                }}
                className="rounded-lg px-4 py-2 mr-2"
              >
                <Text className="text-wave-muted text-sm">{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveSnapchat}
                disabled={savingSnapchat || !snapchatInput.trim()}
                className="bg-wave-primary rounded-lg px-4 py-2"
              >
                {savingSnapchat ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <Text className="text-white text-sm font-semibold">{t("common.save")}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setEditingSnapchat(true)} activeOpacity={0.7}>
            <View className="flex-row justify-between items-center py-1.5">
              <View className="flex-row items-center">
                <Ionicons name="logo-snapchat" size={16} color={COLORS.snapchat} style={{ marginRight: 8 }} />
                <Text className="text-wave-muted text-sm">{t("onboarding.snapchat")}</Text>
              </View>
              <View className="flex-row items-center">
                <Text className="text-white text-sm font-mono mr-2">
                  {snapchatHandle || t("common.notSet")}
                </Text>
                <Ionicons name="pencil" size={14} color={COLORS.primary} />
              </View>
            </View>
          </TouchableOpacity>
        )}

        <Text className="text-wave-muted text-xs mt-3 leading-4">
          {t("settings.socialsHint")}
        </Text>
      </Section>

      {/* Note */}
      <Section title={t("settings.noteSection")}>
        {editingNote ? (
          <View>
            <View className="bg-wave-bg rounded-xl flex-row items-center px-3" style={{ height: 44 }}>
              <TextInput
                value={noteInput}
                onChangeText={setNoteInput}
                placeholder={t("settings.notePlaceholder")}
                placeholderTextColor={COLORS.placeholder}
                autoCapitalize="sentences"
                autoCorrect={false}
                className="flex-1 text-white text-sm"
                style={{ lineHeight: 18, paddingVertical: 0 }}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleSaveNote}
                maxLength={40}
              />
              {noteInput.length > 0 && (
                <TouchableOpacity onPress={() => setNoteInput("")} className="pl-2">
                  <Ionicons name="close-circle" size={18} color={COLORS.muted} />
                </TouchableOpacity>
              )}
            </View>
            <View className="flex-row justify-between items-center mt-2">
              <Text className="text-wave-muted text-xs">{noteInput.length}/40</Text>
              <View className="flex-row">
                <TouchableOpacity
                  onPress={() => {
                    setEditingNote(false);
                    setNoteInput(note ?? "");
                  }}
                  className="rounded-lg px-4 py-2 mr-2"
                >
                  <Text className="text-wave-muted text-sm">{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSaveNote}
                  disabled={savingNote}
                  className="bg-wave-primary rounded-lg px-5 py-2"
                >
                  {savingNote ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : (
                    <Text className="text-white text-sm font-semibold">{t("common.save")}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
          <TouchableOpacity onPress={() => { setNoteInput(note ?? ""); setEditingNote(true); }} activeOpacity={0.7}>
            <View className="flex-row justify-between items-center py-1.5">
              <Text className="text-wave-muted text-sm">{t("settings.noteSection")}</Text>
              <View className="flex-row items-center">
                <Text className="text-white text-sm mr-2" numberOfLines={1} style={{ maxWidth: 180 }}>
                  {note || t("common.notSet")}
                </Text>
                <Ionicons name="pencil" size={14} color={COLORS.primary} />
              </View>
            </View>
          </TouchableOpacity>
        )}
        <Text className="text-wave-muted text-xs mt-2 leading-4">
          {t("settings.noteHint")}
        </Text>
      </Section>

      {/* Safety */}
      <Section title={t("settings.safety")}>
        <TouchableOpacity
          onPress={openBlockedUsers}
          className="py-3 flex-row justify-between items-center"
        >
          <Text className="text-white text-sm">{t("settings.blockedUsers")}</Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.muted} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setShowSupport(true)}
          className="py-3 flex-row justify-between items-center"
        >
          <Text className="text-white text-sm">{t("settings.contactSupport")}</Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.muted} />
        </TouchableOpacity>
        <TouchableOpacity
          // TODO: Change to "mailto:support@wave-app.com" after setting up domain email
          onPress={() => Linking.openURL("mailto:ahmetnishefcii@gmail.com?subject=Wave%20Support")}
          className="py-3 flex-row justify-between items-center"
        >
          <Text className="text-white text-sm">{t("settings.emailSupport")}</Text>
          <Ionicons name="open-outline" size={14} color={COLORS.muted} />
        </TouchableOpacity>
      </Section>

      {/* Legal — opens in browser (external links) */}
      <Section title={t("settings.legal")}>
        <TouchableOpacity
          // TODO: Change to "https://wave-app.com/privacy" after hosting on custom domain
          onPress={() => Linking.openURL("https://wave-website-dun.vercel.app/privacy")}
          className="py-3 flex-row justify-between items-center"
          accessibilityLabel={t("settings.privacyPolicy")}
          accessibilityRole="link"
        >
          <Text className="text-white text-sm">{t("settings.privacyPolicy")}</Text>
          <Ionicons name="open-outline" size={14} color={COLORS.muted} />
        </TouchableOpacity>
        <TouchableOpacity
          // TODO: Change to "https://wave-app.com/terms" after hosting on custom domain
          onPress={() => Linking.openURL("https://wave-website-dun.vercel.app/terms")}
          className="py-3 flex-row justify-between items-center"
          accessibilityLabel={t("settings.termsOfService")}
          accessibilityRole="link"
        >
          <Text className="text-white text-sm">{t("settings.termsOfService")}</Text>
          <Ionicons name="open-outline" size={14} color={COLORS.muted} />
        </TouchableOpacity>
      </Section>

      {/* Danger zone */}
      <Section title={t("settings.accountActions")}>
        <TouchableOpacity
          onPress={() => {
            Alert.alert(
              t("common.signOut"),
              t("settings.signOutConfirm"),
              [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("common.signOut"),
                  onPress: async () => {
                    try {
                      await signOut();
                      router.replace("/");
                    } catch {
                      showToast(t("settings.signOutError"), "error");
                    }
                  },
                },
              ],
            );
          }}
          className="py-3"
        >
          <Text className="text-white text-sm">{t("common.signOut")}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleDeleteAccount}
          className="py-3"
        >
          <Text className="text-wave-danger text-sm">{t("settings.deleteAccount")}</Text>
        </TouchableOpacity>
        <Text className="text-wave-muted text-xs mt-1">
          {t("settings.deleteHint")}
        </Text>
      </Section>

      {/* App info */}
      <View className="items-center mt-4 mb-12">
        <Text className="text-wave-muted text-xs">
          Wave v{Constants.expoConfig?.version ?? "1.0.0"}
        </Text>
      </View>
    </ScrollView>

    {/* Toast */}
    <Toast message={toastMessage} variant={toastVariant} onDismiss={() => setToastMessage(null)} />

    {/* Language picker */}
    <BottomSheet visible={showLanguagePicker} onClose={() => setShowLanguagePicker(false)}>
      <Text className="text-white text-lg font-semibold text-center mb-4">{t("common.language")}</Text>
      <View style={{ gap: 4 }}>
        {/* System Default option */}
        <TouchableOpacity
          onPress={handleResetLanguage}
          className="flex-row items-center justify-between rounded-xl py-3 px-4 bg-wave-bg"
          activeOpacity={0.7}
        >
          <View className="flex-row items-center">
            <Text className="text-lg mr-3">📱</Text>
            <Text className="text-wave-muted text-sm font-semibold">{t("settings.systemDefault")}</Text>
          </View>
        </TouchableOpacity>

        <View className="h-px bg-wave-muted/20 my-1" />

        {LANGUAGES.map((lang) => {
          const isSelected = lang.code === langCode;
          return (
            <TouchableOpacity
              key={lang.code}
              onPress={() => handleChangeLanguage(lang.code)}
              className={`flex-row items-center justify-between rounded-xl py-3 px-4 ${
                isSelected ? "bg-wave-primary/15 border border-wave-primary/30" : "bg-wave-bg"
              }`}
              activeOpacity={0.7}
            >
              <View className="flex-row items-center">
                <Text className="text-lg mr-3">{lang.flag}</Text>
                <Text className={`text-sm font-semibold ${isSelected ? "text-white" : "text-wave-muted"}`}>
                  {lang.name}
                </Text>
              </View>
              {isSelected && (
                <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </BottomSheet>

    {/* Blocked users */}
    <BottomSheet visible={showBlockedUsers} onClose={() => { setShowBlockedUsers(false); setBlockedSearch(""); }}>
      {unblockTarget ? (
        <>
          {/* Unblock confirmation (inline, same BottomSheet) */}
          <View className="items-center mb-5">
            <Ionicons name="shield-checkmark-outline" size={32} color={COLORS.primary} style={{ marginBottom: 12 }} />
            <Text className="text-white text-lg font-semibold">
              {t("settings.unblock")}
            </Text>
            <Text className="text-wave-muted text-sm mt-2 text-center px-4">
              {t("settings.unblockConfirm", { name: unblockTarget.displayName || t("history.someoneNearby") })}
            </Text>
          </View>

          <TouchableOpacity
            onPress={confirmUnblock}
            disabled={unblocking}
            className="w-full bg-wave-primary rounded-2xl py-4 items-center justify-center mb-2"
            activeOpacity={0.8}
          >
            {unblocking ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Text className="text-white text-sm font-semibold">{t("settings.unblock")}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setUnblockTarget(null)}
            className="items-center py-2"
            activeOpacity={0.7}
          >
            <Text className="text-wave-muted text-sm">{t("common.cancel")}</Text>
          </TouchableOpacity>
        </>
      ) : loadingBlocked ? (
        <View className="items-center py-8">
          <ActivityIndicator size="small" color={COLORS.primary} />
        </View>
      ) : (
        <>
          <Text className="text-white text-lg font-semibold text-center mb-1">{t("settings.blockedUsers")}</Text>
          {blockedUsers.length > 0 && (
            <Text className="text-wave-muted text-xs text-center mb-3">{t("settings.blockedCount", { count: blockedUsers.length })}</Text>
          )}
          {blockedUsers.length === 0 ? (
            <Text className="text-wave-muted text-sm text-center py-8">{t("settings.noBlockedUsers")}</Text>
          ) : (() => {
            const q = blockedSearch.toLowerCase().replace(/^@/, "");
            const filtered = q
              ? blockedUsers.filter((u) => u.displayName?.toLowerCase().replace(/^@/, "").includes(q))
              : blockedUsers;
            return (
              <>
                {/* Search */}
                <View className="bg-wave-bg rounded-xl flex-row items-center px-3 mb-3" style={{ height: 40 }}>
                  <Ionicons name="search" size={16} color={COLORS.muted} style={{ marginRight: 8 }} />
                  <TextInput
                    value={blockedSearch}
                    onChangeText={setBlockedSearch}
                    placeholder={t("settings.searchBlocked")}
                    placeholderTextColor={COLORS.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="flex-1 text-white text-sm"
                    style={{ paddingVertical: 0 }}
                  />
                  {blockedSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setBlockedSearch("")} className="pl-2">
                      <Ionicons name="close-circle" size={16} color={COLORS.muted} />
                    </TouchableOpacity>
                  )}
                </View>

                {filtered.length === 0 ? (
                  <Text className="text-wave-muted text-sm text-center py-6">{t("settings.noSearchResults")}</Text>
                ) : (
                  <ScrollView
                    style={{ maxHeight: 350 }}
                    showsVerticalScrollIndicator
                    indicatorStyle="white"
                    refreshControl={
                      <RefreshControl
                        refreshing={loadingBlocked}
                        onRefresh={() => {
                          setLoadingBlocked(true);
                          getBlockedUsers().then((users) => {
                            setBlockedUsers(users.length > 0 || !__DEV__ ? users : getFakeBlockedUsers());
                            setLoadingBlocked(false);
                          }).catch(() => {
                            setLoadingBlocked(false);
                          });
                        }}
                        tintColor={COLORS.primary}
                      />
                    }
                  >
                    <View style={{ gap: 8 }}>
                      {filtered.map((user) => (
                        <View key={user.blockedId} className="bg-wave-bg rounded-xl py-3 px-4 flex-row items-center justify-between">
                          <View className="flex-1 mr-3">
                            <Text className="text-white text-sm font-semibold">
                              {user.displayName || t("history.someoneNearby")}
                            </Text>
                            <Text className="text-wave-muted text-xs mt-0.5">
                              {formatDateTime(new Date(user.createdAt))}
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => handleUnblock(user.blockedId, user.displayName)}
                            className="bg-wave-primary/15 border border-wave-primary/30 rounded-lg px-4 py-2"
                            activeOpacity={0.7}
                          >
                            <Text className="text-wave-primary text-xs font-semibold">{t("settings.unblock")}</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                )}
              </>
            );
          })()}
        </>
      )}
    </BottomSheet>

    {/* Support ticket */}
    <BottomSheet visible={showSupport} onClose={() => { setShowSupport(false); setTimeout(() => { setSupportCategory(null); setSupportDetails(""); setTicketConfirmed(false); setTicketError(null); }, 300); }}>
      {ticketConfirmed ? (
        <>
          <View className="items-center mb-6">
            <View className="w-16 h-16 rounded-full bg-wave-accent/20 items-center justify-center mb-4">
              <Ionicons name="checkmark-circle" size={36} color={COLORS.accent} />
            </View>
            <Text className="text-white text-lg font-semibold mb-2">{t("settings.ticketConfirmedTitle")}</Text>
            <Text className="text-wave-muted text-sm text-center px-4">{t("settings.ticketConfirmedBody")}</Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              setShowSupport(false);
              // Reset form AFTER sheet animation completes so the form doesn't flash
              setTimeout(() => { setSupportCategory(null); setSupportDetails(""); setTicketConfirmed(false); setTicketError(null); }, 300);
            }}
            className="w-full bg-wave-primary rounded-2xl py-4 items-center"
            activeOpacity={0.8}
          >
            <Text className="text-white text-sm font-semibold">{t("common.done")}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View className="items-center mb-5">
            <Ionicons name="chatbubble-ellipses-outline" size={32} color={COLORS.primary} style={{ marginBottom: 12 }} />
            <Text className="text-white text-lg font-semibold">{t("settings.supportTitle")}</Text>
            <Text className="text-wave-muted text-sm mt-2 text-center">{t("settings.supportDescription")}</Text>
          </View>

          <View style={{ gap: 6 }} className="mb-4">
            {[
              { key: "bug", label: t("settings.supportBugReport"), icon: "bug-outline" as const },
              { key: "account", label: t("settings.supportAccountIssue"), icon: "person-outline" as const },
              { key: "feature", label: t("settings.supportFeatureRequest"), icon: "bulb-outline" as const },
              { key: "other", label: t("settings.supportOther"), icon: "ellipsis-horizontal-outline" as const },
            ].map((item) => {
              const isSelected = supportCategory === item.key;
              return (
                <TouchableOpacity
                  key={item.key}
                  onPress={() => setSupportCategory(item.key)}
                  className={`rounded-xl py-3 px-4 flex-row items-center border ${
                    isSelected ? "bg-wave-primary/15 border-wave-primary/30" : "bg-wave-bg border-transparent"
                  }`}
                  activeOpacity={0.7}
                >
                  <Ionicons name={item.icon} size={20} color={isSelected ? COLORS.primary : COLORS.text} style={{ marginRight: 12 }} />
                  <Text className={`text-sm font-semibold flex-1 ${isSelected ? "text-white" : "text-wave-muted"}`}>{item.label}</Text>
                  {isSelected && <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {supportCategory && (
            <View className="bg-wave-bg rounded-xl px-4 mb-4" style={{ height: 80 }}>
              <TextInput
                value={supportDetails}
                onChangeText={setSupportDetails}
                placeholder={t("settings.supportDetailsPlaceholder")}
                placeholderTextColor={COLORS.placeholder}
                multiline
                className="flex-1 text-white text-sm"
                style={{ paddingVertical: 12, textAlignVertical: "top" }}
                maxLength={1000}
              />
            </View>
          )}

          {ticketError && (
            <View className="bg-wave-danger/15 border border-wave-danger/30 rounded-xl px-4 py-3 mb-3">
              <Text className="text-wave-danger text-sm text-center">{ticketError}</Text>
            </View>
          )}

          <TouchableOpacity
            onPress={handleSubmitTicket}
            disabled={!supportCategory || submittingTicket}
            className={`w-full rounded-2xl py-4 items-center justify-center mb-2 ${supportCategory ? "bg-wave-primary" : "bg-wave-primary/30"}`}
            activeOpacity={0.8}
          >
            {submittingTicket ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Text className={`text-sm font-semibold ${supportCategory ? "text-white" : "text-wave-muted"}`}>
                {t("settings.submitTicket")}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => { setShowSupport(false); setSupportCategory(null); setSupportDetails(""); }}
            className="items-center py-2"
            activeOpacity={0.7}
          >
            <Text className="text-wave-muted text-sm">{t("common.cancel")}</Text>
          </TouchableOpacity>
        </>
      )}
    </BottomSheet>

    </>
  );
}

function formatDateTime(date: Date): string {
  const dateStr = date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${dateStr}, ${timeStr}`;
}

function formatDob(dob: string): string {
  const d = new Date(dob + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mb-6">
      <Text className="text-wave-muted text-xs uppercase tracking-wider mb-2">
        {title}
      </Text>
      <View className="bg-wave-surface rounded-2xl p-4">{children}</View>
    </View>
  );
}

function InfoRow({
  label,
  value,
  isError = false,
}: {
  label: string;
  value: string;
  isError?: boolean;
}) {
  return (
    <View className="flex-row justify-between items-center py-1.5">
      <Text className="text-wave-muted text-sm">{label}</Text>
      <Text
        className={`text-sm font-mono ${isError ? "text-wave-danger" : "text-white"}`}
        numberOfLines={1}
        style={{ maxWidth: 180 }}
      >
        {value}
      </Text>
    </View>
  );
}
