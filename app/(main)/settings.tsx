import { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, Linking, TextInput, Switch } from "react-native";
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
  unlinkIdentity,
  type LinkedIdentity,
  type AuthProvider,
} from "@/services/authLinking";
import { saveInstagramHandle, saveSnapchatHandle, updateGenderPreference, updateAgePreference, saveNote, saveNearbyAlertsPreference, saveDailyPushesPreference } from "@/services/profile";
import { containsProfanity } from "@/utils/contentFilter";
import { requestLocationPermission, hasLocationPermission, isLocationBlocked, resetLocationCache } from "@/services/location";
import { supabase } from "@/services/supabase";
import { waveBleManager } from "@/services/ble/bleManager";
import { impactLight } from "@/utils/haptics";
import { Toast, type ToastVariant } from "@/components/Toast";
import { AgeRangeSlider } from "@/components/AgeRangeSlider";
import { PhoneLinkSheet } from "@/components/PhoneLinkSheet";
import { BlockedUsersSheet } from "@/components/BlockedUsersSheet";
import { SupportTicketSheet } from "@/components/SupportTicketSheet";
import { LanguagePickerSheet } from "@/components/LanguagePickerSheet";
import { COLORS } from "@/constants/colors";
import { getAgeFromDob } from "@/utils/age";
import i18n from "@/i18n";
import type { GenderPreference } from "@/types";

const PREFERENCE_OPTIONS: { value: GenderPreference; labelKey: string }[] = [
  { value: "male", labelKey: "gender.men" },
  { value: "female", labelKey: "gender.women" },
  { value: "both", labelKey: "gender.everyone" },
];

const LANGUAGES = [
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
  { code: "pt", name: "Portuguese", flag: "🇵🇹" },
  { code: "tr", name: "Turkish", flag: "🇹🇷" },
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
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastVariant, setToastVariant] = useState<ToastVariant>("success");

  // Linked accounts state
  const [linkedIdentities, setLinkedIdentities] = useState<LinkedIdentity[]>([]);
  const [linkingProvider, setLinkingProvider] = useState<AuthProvider | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  // Bottom sheet visibility
  const [showPhoneLink, setShowPhoneLink] = useState(false);
  const [showBlockedUsers, setShowBlockedUsers] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);

  // Handle editing state
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

  useEffect(() => {
    getLinkedIdentities().then(setLinkedIdentities);
  }, []);

  const showToast = useCallback((msg: string, variant: ToastVariant = "success") => {
    setToastVariant(variant);
    setToastMessage(msg);
  }, []);

  const refreshLinkedIdentities = useCallback(async () => {
    const updated = await getLinkedIdentities();
    setLinkedIdentities(updated);
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
      setShowPhoneLink(true);
      return;
    } else {
      setLinkingProvider(null);
      return;
    }

    setLinkingProvider(null);

    if (result.success) {
      await refreshLinkedIdentities();
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
              await refreshLinkedIdentities();
              showToast(t("settings.identityUnlinked"));
            } else {
              showToast(result.error ?? t("settings.unlinkFailed"), "error");
            }
          },
        },
      ],
    );
  };

  const langCode = i18n.language?.substring(0, 2) ?? "en";
  const currentLang = LANGUAGES.find((l) => l.code === langCode) ?? LANGUAGES[0];

  const handleSaveHandle = async () => {
    if (savingHandle) return;
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
    if (savingSnapchat) return;
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
  }, [setAgePreference, showToast, t]);

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

    if (trimmed && containsProfanity(trimmed)) {
      showToast(t("note.inappropriate"), "error");
      return;
    }

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
      {/* Bottom sheets */}
      <PhoneLinkSheet
        visible={showPhoneLink}
        onClose={() => setShowPhoneLink(false)}
        onLinked={refreshLinkedIdentities}
        showToast={showToast}
      />

      <BlockedUsersSheet
        visible={showBlockedUsers}
        onClose={() => setShowBlockedUsers(false)}
        showToast={showToast}
      />

      <SupportTicketSheet
        visible={showSupport}
        onClose={() => setShowSupport(false)}
      />

      <LanguagePickerSheet
        visible={showLanguagePicker}
        onClose={() => setShowLanguagePicker(false)}
        showToast={showToast}
      />

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
          onPress={() => setShowBlockedUsers(true)}
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
          onPress={() => Linking.openURL("mailto:support@wavenearby.com?subject=Wave%20Support")}
          className="py-3 flex-row justify-between items-center"
        >
          <Text className="text-white text-sm">{t("settings.emailSupport")}</Text>
          <Ionicons name="open-outline" size={14} color={COLORS.muted} />
        </TouchableOpacity>
      </Section>

      {/* Legal — opens in browser (external links) */}
      <Section title={t("settings.legal")}>
        <TouchableOpacity
          onPress={() => Linking.openURL("https://www.wavenearby.com/privacy")}
          className="py-3 flex-row justify-between items-center"
          accessibilityLabel={t("settings.privacyPolicy")}
          accessibilityRole="link"
        >
          <Text className="text-white text-sm">{t("settings.privacyPolicy")}</Text>
          <Ionicons name="open-outline" size={14} color={COLORS.muted} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => Linking.openURL("https://www.wavenearby.com/terms")}
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

    </>
  );
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
