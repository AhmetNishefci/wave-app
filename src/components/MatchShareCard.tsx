import { useRef, useCallback, useState } from "react";
import { View, Text, Image, TouchableOpacity, ActivityIndicator, Share, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import ViewShot from "react-native-view-shot";
import { impactMedium } from "@/utils/haptics";
import { COLORS } from "@/constants/colors";
import { logger } from "@/utils/logger";

const waveHand = require("../../assets/wave-hand.png");

/**
 * "Share Match" button + hidden card that captures a branded image
 * for sharing to Instagram/Snapchat stories. The card is rendered
 * invisible but in the layout tree (so images load), captured as a
 * PNG, then shared via the native share sheet.
 *
 * The card is intentionally generic — no handles or usernames to
 * protect the privacy of both users.
 */
export function MatchShareCard() {
  const { t } = useTranslation();
  const viewShotRef = useRef<ViewShot>(null);
  const [sharing, setSharing] = useState(false);

  const handleShare = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    impactMedium();

    try {
      const uri = await viewShotRef.current?.capture?.();
      if (!uri) {
        logger.warn("MatchShareCard: capture returned no URI");
        setSharing(false);
        return;
      }

      await Share.share({
        url: Platform.OS === "ios" ? uri : `file://${uri}`,
      });
    } catch (err) {
      logger.warn("MatchShareCard: share failed", err);
    } finally {
      setSharing(false);
    }
  }, [sharing]);

  return (
    <>
      {/* Share button — visible */}
      <TouchableOpacity
        onPress={handleShare}
        disabled={sharing}
        className="flex-row items-center justify-center py-3"
        activeOpacity={0.7}
        accessibilityLabel={t("match.shareMatch")}
        accessibilityRole="button"
      >
        {sharing ? (
          <ActivityIndicator size="small" color={COLORS.muted} />
        ) : (
          <>
            <Ionicons name="share-outline" size={16} color={COLORS.muted} style={{ marginRight: 6 }} />
            <Text className="text-wave-muted text-sm font-semibold">{t("match.shareMatch")}</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Card — rendered invisible but in layout tree so images load */}
      <View style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}>
        <ViewShot
          ref={viewShotRef}
          options={{ format: "png", quality: 1, width: 1080, height: 1920 }}
        >
          <View
            style={{
              width: 1080,
              height: 1920,
              backgroundColor: COLORS.bg,
              alignItems: "center",
              justifyContent: "center",
              padding: 80,
            }}
          >
            {/* Ambient glow */}
            <View
              style={{
                position: "absolute",
                width: 900,
                height: 900,
                borderRadius: 450,
                backgroundColor: COLORS.primary,
                opacity: 0.04,
              }}
            />

            {/* Wave hand logo */}
            <Image
              source={waveHand}
              style={{ width: 220, height: 220, marginBottom: 56, tintColor: COLORS.primary }}
              resizeMode="contain"
            />

            {/* Title */}
            <Text
              style={{
                color: COLORS.white,
                fontSize: 80,
                fontWeight: "800",
                textAlign: "center",
                marginBottom: 24,
              }}
            >
              {t("shareCard.title")}
            </Text>

            {/* Subtitle */}
            <Text
              style={{
                color: COLORS.muted,
                fontSize: 36,
                textAlign: "center",
                lineHeight: 52,
                marginBottom: 120,
              }}
            >
              {t("shareCard.subtitle")}
            </Text>

            {/* Branding */}
            <Text
              style={{
                color: COLORS.primary,
                fontSize: 48,
                fontWeight: "800",
                letterSpacing: 4,
              }}
            >
              {t("shareCard.brand")}
            </Text>
            <Text
              style={{
                color: COLORS.muted,
                fontSize: 26,
                marginTop: 16,
              }}
            >
              {t("shareCard.tagline")}
            </Text>
          </View>
        </ViewShot>
      </View>
    </>
  );
}
