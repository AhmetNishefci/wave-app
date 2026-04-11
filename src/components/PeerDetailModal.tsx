import { useState } from "react";
import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
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
  { key: "harassment", labelKey: "history.reportReasonHarassment" },
  { key: "inappropriate", labelKey: "history.reportReasonInappropriate" },
  { key: "spam", labelKey: "history.reportReasonSpam" },
  { key: "other", labelKey: "history.reportReasonOther" },
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

  const handleReport = () => {
    if (!peer.userId) return;
    Alert.alert(
      t("history.reportUser"),
      t("history.reportReasonPrompt"),
      [
        ...REPORT_REASONS.map((reason) => ({
          text: t(reason.labelKey),
          onPress: async () => {
            setBlocking(true);
            const result = await blockUser({
              blockedId: peer.userId!,
              displayName: peer.note ?? undefined,
              reason: reason.key,
            });
            if (result.success) {
              applyBlock(peer.userId!);
              onClose();
              setToast({
                message: result.reportCreated
                  ? t("history.reportedAndBlocked")
                  : t("history.blocked"),
              });
              logger.wave("Peer reported from radar", { reason: reason.key });
            } else {
              setBlocking(false);
              Alert.alert(t("common.error"), t("history.reportError"));
            }
          },
        })),
        { text: t("common.cancel"), style: "cancel" },
      ],
    );
  };

  return (
    <BottomSheet visible onClose={onClose}>
      {/* Avatar + Note */}
      <View className="items-center mb-4">
        <View
          className={`w-14 h-14 rounded-full items-center justify-center mb-3 ${
            isMatched ? "bg-pink-500/20 border-2 border-pink-500/40" : `${avatar.bg} border-2 ${avatar.ring}`
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
            onPress={handleReport}
            disabled={blocking}
            className="flex-1 bg-wave-bg rounded-xl py-3 flex-row items-center justify-center"
            activeOpacity={0.7}
          >
            {blocking ? (
              <ActivityIndicator size="small" color={COLORS.muted} />
            ) : (
              <>
                <Ionicons name="flag-outline" size={16} color={COLORS.muted} style={{ marginRight: 6 }} />
                <Text className="text-wave-muted text-sm">{t("history.reportUser")}</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleBlock}
            disabled={blocking}
            className="flex-1 bg-wave-bg rounded-xl py-3 flex-row items-center justify-center"
            activeOpacity={0.7}
          >
            <Ionicons name="ban-outline" size={16} color={COLORS.muted} style={{ marginRight: 6 }} />
            <Text className="text-wave-muted text-sm">{t("history.blockUser")}</Text>
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
