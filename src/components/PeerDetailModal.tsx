import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { openInstagramProfile, openSnapchatProfile } from "@/utils/deepLink";
import { useMatchStore } from "@/stores/matchStore";
import { useBleStore } from "@/stores/bleStore";
import { BottomSheet } from "@/components/BottomSheet";
import { SocialActionRow } from "@/components/SocialActionRow";
import { ZONE_CONFIG } from "@/constants/zones";
import { COLORS } from "@/constants/colors";
import { blockUser } from "@/services/wave/waves";
import { clearWaveStateForUser } from "@/utils/waveCleanup";
import { logger } from "@/utils/logger";
import type { NearbyPeer } from "@/types";
import { getDistanceZone, getSignalLabel, getAvatarForToken, getTimeSince } from "@/types";

const REPORT_REASONS = [
  { key: "harassment", labelKey: "history.reportReasonHarassment", icon: "alert-circle-outline" as const },
  { key: "inappropriate", labelKey: "history.reportReasonInappropriate", icon: "eye-off-outline" as const },
  { key: "spam", labelKey: "history.reportReasonSpam", icon: "copy-outline" as const },
  { key: "other", labelKey: "history.reportReasonOther", icon: "ellipsis-horizontal-outline" as const },
];

export function PeerDetailModal({
  peer,
  onClose,
  setToast,
}: {
  peer: NearbyPeer;
  onClose: () => void;
  setToast: (toast: { message: string; variant?: "success" | "error" } | null) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const avatar = getAvatarForToken(peer.ephemeralToken);
  const signal = getSignalLabel(peer.rssi);
  const zone = getDistanceZone(peer.rssi);
  const zoneLabel = ZONE_CONFIG[zone].label;
  const zoneColor = ZONE_CONFIG[zone].color;
  const freshness = getTimeSince(peer.lastSeen);
  const isMatched = useMatchStore((s) => s.matchedTokens.has(peer.ephemeralToken));
  const matchedHandles = useMatchStore((s) => s.matchedHandles.get(peer.ephemeralToken));
  const instagramHandle = matchedHandles?.instagram;
  const snapchatHandle = matchedHandles?.snapchat;

  const [blocking, setBlocking] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [reportDetails, setReportDetails] = useState("");

  const applyBlock = (userId: string) => {
    useBleStore.getState().removeByUserId(userId);
    useBleStore.getState().addBlockedUserId(userId);
    clearWaveStateForUser(userId);
  };

  const handleBlock = () => {
    if (!peer.userId) return;
    Alert.alert(
      t("history.blockUser"),
      t("history.blockConfirm", { name: peer.note || t("peerDetail.someone") }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("history.blockUser"),
          style: "destructive",
          onPress: async () => {
            setBlocking(true);
            const result = await blockUser({ blockedId: peer.userId! });
            if (result.success) {
              applyBlock(peer.userId!);
              onClose();
              setToast({ message: t("history.blocked") });
            } else {
              setBlocking(false);
              Alert.alert(t("common.error"), t("history.blockError"));
            }
          },
        },
      ],
    );
  };

  const handleSubmitReport = async () => {
    if (!peer.userId || !selectedReason) return;
    setBlocking(true);
    const result = await blockUser({
      blockedId: peer.userId,
      displayName: peer.note ?? undefined,
      reason: selectedReason,
      details: reportDetails.trim() || undefined,
    });
    if (result.success) {
      applyBlock(peer.userId);
      onClose();
      setToast({
        message: result.reportCreated
          ? t("history.reportedAndBlocked")
          : t("history.blocked"),
      });
      logger.wave("Peer reported from radar", { reason: selectedReason });
    } else {
      setBlocking(false);
      Alert.alert(t("common.error"), t("history.reportError"));
    }
  };

  // Report flow UI (replaces the default peer detail view)
  if (showReport) {
    return (
      <BottomSheet visible onClose={onClose}>
        <View className="items-center mb-4">
          <Ionicons name="flag-outline" size={28} color={COLORS.primary} style={{ marginBottom: 8 }} />
          <Text className="text-white text-lg font-semibold">
            {t("history.reportTitle", { name: peer.note || t("peerDetail.someone") })}
          </Text>
          <Text className="text-wave-muted text-sm mt-2 text-center px-4">
            {t("history.reportReasonPrompt")}
          </Text>
        </View>

        {/* Reason picker */}
        <View style={{ gap: 6 }} className="mb-4">
          {REPORT_REASONS.map((reason) => {
            const isSelected = selectedReason === reason.key;
            return (
              <TouchableOpacity
                key={reason.key}
                onPress={() => setSelectedReason(reason.key)}
                className={`rounded-xl py-3 px-4 flex-row items-center border ${
                  isSelected ? "bg-wave-primary/15 border-wave-primary/30" : "bg-wave-bg border-transparent"
                }`}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={reason.icon}
                  size={20}
                  color={isSelected ? COLORS.primary : COLORS.text}
                  style={{ marginRight: 12 }}
                />
                <Text className={`text-sm font-semibold flex-1 ${isSelected ? "text-white" : "text-wave-muted"}`}>
                  {t(reason.labelKey)}
                </Text>
                {isSelected && <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Optional details */}
        {selectedReason && (
          <View className="bg-wave-bg rounded-xl px-4 mb-4" style={{ height: 80 }}>
            <TextInput
              value={reportDetails}
              onChangeText={setReportDetails}
              placeholder={t("history.reportDetailsPlaceholder")}
              placeholderTextColor={COLORS.placeholder}
              multiline
              className="flex-1 text-white text-sm"
              style={{ paddingVertical: 12, textAlignVertical: "top" }}
              maxLength={500}
            />
          </View>
        )}

        {/* Submit */}
        <TouchableOpacity
          onPress={handleSubmitReport}
          disabled={!selectedReason || blocking}
          className={`w-full rounded-2xl py-4 items-center justify-center mb-2 ${
            selectedReason ? "bg-wave-danger" : "bg-wave-danger/30"
          }`}
          activeOpacity={0.8}
        >
          {blocking ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <Text className={`text-sm font-semibold ${selectedReason ? "text-white" : "text-wave-muted"}`}>
              {t("history.submitReport")}
            </Text>
          )}
        </TouchableOpacity>

        {/* Cancel */}
        <TouchableOpacity
          onPress={() => { setShowReport(false); setSelectedReason(null); setReportDetails(""); }}
          className="items-center py-2"
          activeOpacity={0.7}
        >
          <Text className="text-wave-muted text-sm">{t("common.cancel")}</Text>
        </TouchableOpacity>
      </BottomSheet>
    );
  }

  // Default peer detail view
  return (
    <BottomSheet visible onClose={onClose}>
      {/* Avatar + Note */}
      <View className="items-center mb-4">
        <View
          className={`w-14 h-14 rounded-full items-center justify-center mb-3 ${
            isMatched ? "bg-wave-match/20 border-2 border-wave-match/40" : `${avatar.bg} border-2 ${avatar.ring}`
          }`}
        >
          <Text className="text-2xl">{isMatched ? "✨" : avatar.emoji}</Text>
        </View>
        <Text className="text-white text-lg font-semibold text-center px-4">
          {peer.note || t("peerDetail.someone")}
        </Text>
        {isMatched && (
          <View className="bg-wave-match/20 rounded-full px-3 py-1 mt-2">
            <Text className="text-wave-match text-xs font-semibold">{t("peerDetail.matched")}</Text>
          </View>
        )}
      </View>

      {/* Contact actions (if matched) */}
      {isMatched && (instagramHandle || snapchatHandle) && (
        <View className="mb-4" style={{ gap: 8 }}>
          {instagramHandle && (
            <SocialActionRow
              platform="instagram"
              handle={instagramHandle}
              onPress={() => openInstagramProfile(instagramHandle)}
            />
          )}
          {snapchatHandle && (
            <SocialActionRow
              platform="snapchat"
              handle={snapchatHandle}
              onPress={() => openSnapchatProfile(snapchatHandle)}
            />
          )}
        </View>
      )}

      {/* Details */}
      <View className="bg-wave-bg rounded-xl px-4 py-3 mb-4">
        <View className="flex-row justify-between items-center mb-2">
          <Text className="text-wave-muted text-sm">{t("peerDetail.distance")}</Text>
          <Text className={`text-sm font-medium ${zoneColor}`}>{zoneLabel}</Text>
        </View>
        <View className="flex-row justify-between items-center mb-2">
          <Text className="text-wave-muted text-sm">{t("peerDetail.signal")}</Text>
          <Text className="text-white text-sm">{signal}</Text>
        </View>
        <View className="flex-row justify-between items-center">
          <Text className="text-wave-muted text-sm">{t("peerDetail.lastSeen")}</Text>
          <Text className="text-white text-sm">{freshness}</Text>
        </View>
      </View>

      {/* View Matches (if matched) */}
      {isMatched && (
        <TouchableOpacity
          onPress={() => { onClose(); router.push("/(main)/history"); }}
          className="bg-wave-primary rounded-xl py-3 items-center mb-3"
          accessibilityLabel={t("peerDetail.viewAllMatches")}
          accessibilityRole="button"
        >
          <Text className="text-white text-sm font-semibold">{t("peerDetail.viewAllMatches")}</Text>
        </TouchableOpacity>
      )}

      {/* Block & Report (when userId is resolved and not already matched) */}
      {peer.userId && !isMatched && (
        <View className="flex-row mb-3" style={{ gap: 8 }}>
          <TouchableOpacity
            onPress={() => setShowReport(true)}
            disabled={blocking}
            className="flex-1 bg-wave-bg rounded-xl py-3 flex-row items-center justify-center"
            activeOpacity={0.7}
          >
            <Ionicons name="flag-outline" size={16} color={COLORS.danger} style={{ marginRight: 6 }} />
            <Text className="text-wave-danger text-sm">{t("history.reportUser")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleBlock}
            disabled={blocking}
            className="flex-1 bg-wave-bg rounded-xl py-3 flex-row items-center justify-center"
            activeOpacity={0.7}
          >
            <Ionicons name="ban-outline" size={16} color={COLORS.danger} style={{ marginRight: 6 }} />
            <Text className="text-wave-danger text-sm">{t("history.blockUser")}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Close */}
      <TouchableOpacity
        onPress={onClose}
        className="bg-wave-bg rounded-xl py-3 items-center"
        accessibilityLabel={t("peerDetail.close")}
        accessibilityRole="button"
      >
        <Text className="text-white text-sm font-semibold">{t("peerDetail.close")}</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}
