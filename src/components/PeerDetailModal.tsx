import { View, Text, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { openInstagramProfile, openSnapchatProfile } from "@/utils/deepLink";
import { useMatchStore } from "@/stores/matchStore";
import { BottomSheet } from "@/components/BottomSheet";
import { SocialActionRow } from "@/components/SocialActionRow";
import { ZONE_CONFIG } from "@/constants/zones";
import type { NearbyPeer } from "@/types";
import { getDistanceZone, getSignalLabel, getAvatarForToken, getTimeSince } from "@/types";

export function PeerDetailModal({
  peer,
  onClose,
}: {
  peer: NearbyPeer;
  onClose: () => void;
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
