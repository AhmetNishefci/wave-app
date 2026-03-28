import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TouchableOpacity, Dimensions, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from "react-native-reanimated";
import { notifySuccess, impactLight } from "@/utils/haptics";
import { playMatchChime } from "@/utils/sound";
import { useMatchStore } from "@/stores/matchStore";
import { supabase } from "@/services/supabase";
import { logger } from "@/utils/logger";
import { openInstagramProfile, openSnapchatProfile } from "@/utils/deepLink";
import { MatchShareCard } from "@/components/MatchShareCard";
import { getIcebreakerForMatch } from "@/constants/icebreakers";
import { COLORS } from "@/constants/colors";
import { useNearbyMatchIds } from "@/hooks/useNearbyMatchIds";
import * as Clipboard from "expo-clipboard";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const CONFETTI_COUNT = 30;
const CONFETTI_COLORS = [
  "#FF6B6B", "#FFD93D", "#6BCB77", "#4D96FF",
  "#FF6BFF", "#FFB86B", "#6BFFD9", "#C56BFF",
];

const MATCH_MILESTONES = [1, 5, 10, 25, 50, 100];

interface ConfettiPiece {
  id: number;
  x: number;
  color: string;
  size: number;
  delay: number;
  rotation: number;
  drift: number;
}

export default function MatchScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const latestUnseenMatch = useMatchStore((s) => s.latestUnseenMatch);
  const nearbyMatchIds = useNearbyMatchIds();

  // Snapshot the match on mount so it doesn't disappear mid-celebration
  // if the other user removes the match (L14 fix)
  const matchSnapshot = useRef(latestUnseenMatch);
  if (latestUnseenMatch && latestUnseenMatch !== matchSnapshot.current) {
    matchSnapshot.current = latestUnseenMatch;
  }
  const displayMatch = matchSnapshot.current;

  useEffect(() => {
    notifySuccess();
    playMatchChime();
  }, []);

  // Navigate away if match no longer exists in the store (V3 fix).
  // The displayMatch ref intentionally freezes the match data for rendering
  // (prevents crashes if the other user blocks/unmatches mid-celebration).
  // But we need a SEPARATE check to detect removal and exit the screen,
  // because the ref never becomes null and the old useEffect never fired.
  const matchStillExists = useMatchStore((s) =>
    displayMatch ? s.matchesById.has(displayMatch.matchId) : false,
  );

  useEffect(() => {
    if (!displayMatch) {
      router.replace("/(main)/radar");
    }
  }, [displayMatch, router]);

  useEffect(() => {
    if (displayMatch && !matchStillExists) {
      logger.wave("Match removed while on celebration — exiting", {
        matchId: displayMatch.matchId,
      });
      useMatchStore.setState({ latestUnseenMatch: null });
      router.replace("/(main)/radar");
    }
  }, [matchStillExists, displayMatch, router]);

  const igHandle = displayMatch?.instagramHandle;
  const scHandle = displayMatch?.snapchatHandle;
  const hasAnyHandle = !!igHandle || !!scHandle;

  // If no handles have arrived yet (Realtime RPC in-flight), retry fetching
  // directly via RPC with timeout. Resolves when handles arrive from store
  // update or after retries exhausted (~8s total).
  const [handleLoading, setHandleLoading] = useState(!hasAnyHandle);
  useEffect(() => {
    if (hasAnyHandle) {
      setHandleLoading(false);
      return;
    }
    if (!displayMatch) return;

    let cancelled = false;
    const retryFetchHandles = async () => {
      const MAX_RETRIES = 2;
      const RETRY_DELAY_MS = 2_500;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (cancelled) return;

        // Check if store was updated by Realtime while we waited
        const storeMatch = useMatchStore.getState().matchesById.get(displayMatch.matchId);
        if (storeMatch?.instagramHandle || storeMatch?.snapchatHandle) {
          const handles: { instagramHandle?: string; snapchatHandle?: string } = {};
          if (storeMatch.instagramHandle) handles.instagramHandle = storeMatch.instagramHandle;
          if (storeMatch.snapchatHandle) handles.snapchatHandle = storeMatch.snapchatHandle;
          useMatchStore.getState().updateMatchHandles(displayMatch.matchId, handles);
          if (!cancelled) setHandleLoading(false);
          return;
        }

        // Direct RPC fetch
        try {
          const { data } = await supabase.rpc("get_matched_contact_handles", {
            p_match_ids: [displayMatch.matchId],
          });

          if (!cancelled && data?.[0]) {
            const row = data[0] as { instagram_handle: string | null; snapchat_handle: string | null };
            if (row.instagram_handle || row.snapchat_handle) {
              const handles: { instagramHandle?: string; snapchatHandle?: string } = {};
              if (row.instagram_handle) handles.instagramHandle = row.instagram_handle;
              if (row.snapchat_handle) handles.snapchatHandle = row.snapchat_handle;
              useMatchStore.getState().updateMatchHandles(displayMatch.matchId, handles);
              setHandleLoading(false);
              return;
            }
          }
        } catch {
          // Timeout or network error — retry
        }

        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }

      if (!cancelled) {
        logger.wave("Match handle retry exhausted — no handles found", {
          matchId: displayMatch.matchId,
        });
        setHandleLoading(false);
      }
    };

    retryFetchHandles();
    return () => { cancelled = true; };
  }, [hasAnyHandle, displayMatch]);

  const confettiPieces = useMemo<ConfettiPiece[]>(() => {
    return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
      id: i,
      x: Math.random() * SCREEN_W,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: 6 + Math.random() * 8,
      delay: Math.random() * 600,
      rotation: Math.random() * 360,
      drift: (Math.random() - 0.5) * 60,
    }));
  }, []);

  const matchCount = useMatchStore((s) => s.matchesById.size);

  const milestone = MATCH_MILESTONES.includes(matchCount)
    ? matchCount === 1
      ? t("match.firstMatch")
      : t("match.matchCount", { count: matchCount })
    : null;

  if (!displayMatch) return null;

  const openInstagram = () => igHandle && openInstagramProfile(igHandle);
  const openSnapchat = () => scHandle && openSnapchatProfile(scHandle);

  const handleDismiss = () => {
    if (displayMatch) {
      useMatchStore.setState({ latestUnseenMatch: null });
      // Mark as seen so the M3 recovery logic doesn't re-trigger the
      // celebration on next app open. The user already saw the match.
      useMatchStore.getState().markMatchSeen(displayMatch.matchId);
    }
    router.replace("/(main)/radar");
  };

  return (
    <View className="flex-1 bg-wave-bg items-center justify-center px-8">
      {/* Confetti — full screen overlay, hidden from accessibility tree */}
      <View
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {confettiPieces.map((piece) => (
          <ConfettiParticle key={piece.id} piece={piece} />
        ))}
      </View>

      {/* Celebration visual */}
      <View className="w-32 h-32 rounded-full bg-wave-match/20 items-center justify-center mb-8">
        <View className="w-24 h-24 rounded-full bg-wave-match/40 items-center justify-center">
          <View className="w-16 h-16 rounded-full bg-wave-match items-center justify-center">
            <Text className="text-4xl">🎉</Text>
          </View>
        </View>
      </View>

      {/* Match text */}
      <Text className="text-4xl font-bold text-white mb-2">{t("match.title")}</Text>
      <Text className="text-wave-muted text-center text-base mb-2">
        {t("match.subtitle")}
      </Text>

      {/* Still Nearby badge */}
      {displayMatch && nearbyMatchIds.has(displayMatch.matchedUserId) && (
        <View className="bg-wave-accent/15 border border-wave-accent/30 rounded-full px-4 py-1.5 mb-3 flex-row items-center">
          <Ionicons name="radio" size={12} color={COLORS.accent} style={{ marginRight: 6 }} />
          <Text className="text-wave-accent text-xs font-semibold">{t("match.stillNearby")}</Text>
        </View>
      )}

      {/* Milestone badge */}
      {milestone && (
        <View className="bg-wave-primary/20 rounded-full px-4 py-1.5 -mt-1 mb-3">
          <Text className="text-wave-primary text-sm font-semibold">{milestone}</Text>
        </View>
      )}

      {/* Contact handles */}
      {hasAnyHandle ? (
        <View className="mb-6 items-center" style={{ gap: 8 }}>
          {igHandle && (
            <TouchableOpacity onPress={openInstagram} className="flex-row items-center">
              <Ionicons name="logo-instagram" size={18} color={COLORS.primary} style={{ marginRight: 6 }} />
              <Text className="text-wave-accent text-lg font-semibold">@{igHandle}</Text>
            </TouchableOpacity>
          )}
          {scHandle && (
            <TouchableOpacity onPress={openSnapchat} className="flex-row items-center">
              <Ionicons name="logo-snapchat" size={18} color={COLORS.snapchat} style={{ marginRight: 6 }} />
              <Text className="text-wave-accent text-lg font-semibold">{scHandle}</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : handleLoading ? (
        <View className="mb-6 flex-row items-center">
          <ActivityIndicator size="small" color={COLORS.muted} />
          <Text className="text-wave-muted text-sm ml-2">{t("match.loadingSocials")}</Text>
        </View>
      ) : (
        <Text className="text-wave-muted text-sm mb-6">{t("match.noSocials")}</Text>
      )}

      {/* Ice-breaker — tap to copy conversation starter */}
      {hasAnyHandle && displayMatch && (
        <IcebreakerPrompt matchId={displayMatch.matchId} />
      )}

      {/* Action buttons — when both exist, first is primary (filled), second is outline */}
      {hasAnyHandle && (
        <View className="w-full mb-4" style={{ gap: 10 }}>
          {igHandle && (
            <TouchableOpacity
              onPress={openInstagram}
              className="bg-wave-match py-4 rounded-2xl flex-row items-center justify-center"
              accessibilityLabel={t("match.openInstagramLabel", { handle: igHandle })}
              accessibilityRole="button"
            >
              <Ionicons name="logo-instagram" size={20} color="white" style={{ marginRight: 8 }} />
              <Text className="text-white text-lg font-semibold">{t("match.openInstagram")}</Text>
            </TouchableOpacity>
          )}
          {scHandle && (
            <TouchableOpacity
              onPress={openSnapchat}
              className={`py-4 rounded-2xl flex-row items-center justify-center ${
                igHandle ? "border border-yellow-400/60" : "bg-yellow-400"
              }`}
              accessibilityLabel={t("match.openSnapchatLabel", { handle: scHandle })}
              accessibilityRole="button"
            >
              <Ionicons name="logo-snapchat" size={20} color={igHandle ? COLORS.snapchat : COLORS.black} style={{ marginRight: 8 }} />
              <Text className={`text-lg font-semibold ${igHandle ? "text-yellow-400" : "text-black"}`}>{t("match.openSnapchat")}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Dismiss button */}
      <TouchableOpacity
        onPress={handleDismiss}
        className={`w-full py-4 rounded-2xl items-center ${hasAnyHandle ? "bg-wave-surface" : "bg-wave-primary"}`}
      >
        <Text className="text-white text-lg font-semibold">{t("match.backToRadar")}</Text>
      </TouchableOpacity>

      {/* Share to story */}
      {displayMatch && <MatchShareCard />}
    </View>
  );
}

/* ─── Ice-breaker Prompt ───────────────────────────────────── */

function IcebreakerPrompt({ matchId }: { matchId: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const prompt = useMemo(() => getIcebreakerForMatch(matchId), [matchId]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    impactLight();
    try {
      await Clipboard.setStringAsync(prompt);
    } catch {
      // Clipboard write failed — silently ignore
      return;
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <TouchableOpacity
      onPress={handleCopy}
      className="w-full bg-wave-surface/60 border border-wave-muted/20 rounded-2xl px-5 py-4 mb-6"
      activeOpacity={0.7}
      accessibilityLabel={t("match.copyIcebreaker", { prompt })}
      accessibilityRole="button"
    >
      <Text className="text-wave-muted text-xs font-semibold uppercase tracking-wider mb-2">
        {t("match.startDm")}
      </Text>
      <Text className="text-white text-base leading-6 mb-3">
        "{prompt}"
      </Text>
      <View className="flex-row items-center">
        <Ionicons
          name={copied ? "checkmark-circle" : "copy-outline"}
          size={14}
          color={copied ? COLORS.accent : COLORS.muted}
          style={{ marginRight: 4 }}
        />
        <Text className={`text-xs font-semibold ${copied ? "text-wave-accent" : "text-wave-muted"}`}>
          {copied ? t("match.copied") : t("match.tapToCopy")}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/* ─── Confetti Particle ─────────────────────────────────────── */

function ConfettiParticle({ piece }: { piece: ConfettiPiece }) {
  const translateY = useSharedValue(-20);
  const opacity = useSharedValue(1);
  const rotate = useSharedValue(0);

  useEffect(() => {
    translateY.value = withDelay(
      piece.delay,
      withTiming(SCREEN_H + 40, {
        duration: 2200 + Math.random() * 800,
        easing: Easing.in(Easing.quad),
      }),
    );
    opacity.value = withDelay(
      piece.delay + 1800,
      withTiming(0, { duration: 600 }),
    );
    rotate.value = withDelay(
      piece.delay,
      withTiming(piece.rotation + 720, {
        duration: 2600,
        easing: Easing.linear,
      }),
    );
  }, [piece, translateY, opacity, rotate]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { translateX: piece.drift },
      { rotate: `${rotate.value}deg` },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          top: -20,
          left: piece.x,
          width: piece.size,
          height: piece.size * 1.4,
          backgroundColor: piece.color,
          borderRadius: 2,
        },
        style,
      ]}
    />
  );
}
