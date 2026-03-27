import { useEffect, useMemo, useCallback } from "react";
import { View, Text, TouchableOpacity, Pressable, ActivityIndicator } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withSequence, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useWaveStore } from "@/stores/waveStore";
import { useMatchStore } from "@/stores/matchStore";
import type { NearbyPeer } from "@/types";
import { getAvatarForToken, getDistanceZone } from "@/types";
import { ZONE_CONFIG } from "@/constants/zones";
import { WAVE_EXPIRY_MINUTES } from "@/services/ble/constants";

const WAVE_EXPIRY_MS = WAVE_EXPIRY_MINUTES * 60 * 1_000;

export function PeerRow({
  peer,
  onWave,
  onUndo,
  onPress,
  isOffline,
}: {
  peer: NearbyPeer;
  onWave: (p: NearbyPeer) => void;
  onUndo: (token: string) => void;
  onPress: (p: NearbyPeer) => void;
  isOffline: boolean;
}) {
  const { t } = useTranslation();
  const wavePending = useWaveStore(
    (s) => s.pendingWaves.get(peer.ephemeralToken) ?? null,
  );
  const isAlreadyMatched = useMatchStore((s) => {
    if (s.matchedTokens.has(peer.ephemeralToken)) return true;
    if (!peer.userId) return false;
    for (const m of s.matchesById.values()) {
      if (m.matchedUserId === peer.userId) return true;
    }
    return false;
  });
  const hasWavedAtMe = useWaveStore(
    (s) => s.incomingWaveTokens.includes(peer.ephemeralToken),
  );
  const isWavingBack = useWaveStore(
    (s) => s.wavingBackTokens.has(peer.ephemeralToken),
  );
  const avatar = useMemo(
    () => getAvatarForToken(peer.ephemeralToken),
    [peer.ephemeralToken],
  );
  const zone = getDistanceZone(peer.rssi);
  const displayName = peer.note || t("peerRow.someone", { zone: ZONE_CONFIG[zone].label.toLowerCase() });

  // Wave send animation — brief scale pulse
  const scale = useSharedValue(1);
  const animatedRowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handleWaveWithAnimation = useCallback((p: NearbyPeer) => {
    scale.value = withSequence(
      withTiming(0.95, { duration: 100 }),
      withTiming(1.02, { duration: 150 }),
      withTiming(1, { duration: 100 }),
    );
    onWave(p);
  }, [onWave, scale]);

  // Auto-expire wave after 15 minutes — revert button to Wave
  useEffect(() => {
    if (!wavePending) return;

    const elapsed = Date.now() - wavePending.sentAt;
    if (elapsed >= WAVE_EXPIRY_MS) {
      useWaveStore.getState().removePendingWave(peer.ephemeralToken);
      return;
    }

    const timer = setTimeout(() => {
      useWaveStore.getState().removePendingWave(peer.ephemeralToken);
    }, WAVE_EXPIRY_MS - elapsed);

    return () => clearTimeout(timer);
  }, [wavePending, peer.ephemeralToken]);

  return (
    <Animated.View
      style={animatedRowStyle}
      className={`py-3 px-4 mb-2 rounded-xl flex-row items-center ${
        isAlreadyMatched
          ? "bg-pink-500/10 border border-pink-500/20"
          : hasWavedAtMe
            ? "bg-green-500/10 border border-green-500/20"
            : "bg-wave-surface"
      }`}
    >
      {/* Tappable area: avatar + info */}
      <Pressable onPress={() => onPress(peer)} className="flex-row items-center flex-1 mr-3">
        {/* Avatar */}
        <View
          className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${
            isAlreadyMatched ? "bg-pink-500/20 border-2 border-pink-500/40" : `${avatar.bg} border-2 ${avatar.ring}`
          }`}
        >
          <Text className="text-lg">{isAlreadyMatched ? "✨" : avatar.emoji}</Text>
        </View>

        {/* Info */}
        <View className="flex-1">
          <View className="flex-row items-center">
            <Text className="text-white text-base flex-shrink" numberOfLines={1}>
              {displayName}
            </Text>
            {isAlreadyMatched ? (
              <Text className="text-pink-400 text-xs ml-2">{t("peerRow.matched")}</Text>
            ) : hasWavedAtMe ? (
              <Text className="text-green-400 text-xs ml-2">{t("peerRow.wavedAtYou")}</Text>
            ) : wavePending ? (
              <Text className="text-orange-400 text-xs ml-2">{t("peerRow.waitingForWaveBack")}</Text>
            ) : null}
          </View>
          <View className="flex-row items-center">
            <View className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
              zone === "HERE" ? "bg-green-400" : zone === "CLOSE" ? "bg-blue-400" : "bg-wave-muted"
            }`} />
            <Text className={`text-xs ${
              zone === "HERE" ? "text-green-400" : zone === "CLOSE" ? "text-blue-400" : "text-wave-muted"
            }`}>{ZONE_CONFIG[zone].label}</Text>
          </View>
        </View>
      </Pressable>

      {/* Wave / Undo / Matched */}
      {isAlreadyMatched ? (
        <TouchableOpacity
          onPress={() => onPress(peer)}
          className="bg-wave-match/20 border border-wave-match/40 rounded-lg px-3 py-1.5"
        >
          <Text className="text-wave-match font-semibold text-sm">
            {t("peerRow.matchedButton")}
          </Text>
        </TouchableOpacity>
      ) : wavePending ? (
        <TouchableOpacity
          onPress={() => onUndo(peer.ephemeralToken)}
          className="bg-orange-500/20 border border-orange-500/40 rounded-lg px-3 py-1.5"
        >
          <Text className="text-orange-400 font-semibold text-sm">{t("peerRow.undo")}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={() => handleWaveWithAnimation(peer)}
          disabled={isOffline || isWavingBack}
          className={`rounded-lg px-3 py-1.5 ${
            isOffline
              ? "bg-wave-muted/10 border border-wave-muted/20"
              : hasWavedAtMe
                ? "bg-green-500/20 border border-green-500/40"
                : "bg-wave-wave/20 border border-wave-wave/40"
          }`}
        >
          {isWavingBack ? (
            <ActivityIndicator size="small" color="#4ade80" />
          ) : (
            <Text
              className={`font-semibold text-sm ${
                isOffline
                  ? "text-wave-muted"
                  : hasWavedAtMe ? "text-green-400" : "text-wave-wave"
              }`}
            >
              {hasWavedAtMe ? t("peerRow.waveBack") : t("peerRow.wave")}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}
