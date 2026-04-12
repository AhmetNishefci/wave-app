import { View, Text, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import { ScanPulse } from "@/components/ScanPulse";

type Props = {
  isDiscoveryActive: boolean;
  showProximityHint: boolean;
  onInvite: () => void;
};

export function RadarEmptyState({ isDiscoveryActive, showProximityHint, onInvite }: Props) {
  const { t } = useTranslation();

  if (isDiscoveryActive) {
    return (
      <View className="items-center mt-16">
        {/* Pulse animation */}
        <ScanPulse />

        <Text className="text-white text-base font-semibold mb-2 mt-6">
          {t("radar.scanningTitle")}
        </Text>
        {showProximityHint ? (
          <Text className="text-wave-muted text-sm text-center px-8 mb-8">
            {t("radar.proximityHint")}
          </Text>
        ) : (
          <Text className="text-wave-muted text-sm text-center px-8 mb-8">
            {t("radar.scanningDescription")}
          </Text>
        )}

        {/* Invite CTA */}
        <TouchableOpacity
          onPress={onInvite}
          className="bg-wave-surface border border-wave-muted rounded-2xl py-3 px-6 flex-row items-center"
        >
          <Text className="text-lg mr-2">📲</Text>
          <Text className="text-white font-semibold text-sm">
            {t("radar.inviteFriends")}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="items-center mt-16">
      {/* Static radar icon (no pulse) */}
      <View className="w-36 h-36 items-center justify-center">
        <View className="absolute w-36 h-36 rounded-full border-2 border-wave-primary/15" />
        <View className="absolute w-24 h-24 rounded-full border-2 border-wave-primary/20" />
        <View className="w-16 h-16 rounded-full bg-wave-primary/20 items-center justify-center border-2 border-wave-primary/40">
          <Text className="text-3xl">📡</Text>
        </View>
      </View>

      <Text className="text-white text-lg font-bold mb-2 mt-6">
        {t("radar.discoverTitle")}
      </Text>
      <Text className="text-wave-muted text-sm text-center px-8 leading-5">
        {t("radar.discoverDescription").split("<bold>").map((part: string, i: number) => {
          if (i === 0) return part;
          const [bold, rest] = part.split("</bold>");
          return (
            <Text key={i}>
              <Text className="text-wave-primary font-semibold">{bold}</Text>
              {rest}
            </Text>
          );
        })}
      </Text>

      {/* Invite CTA */}
      <TouchableOpacity
        onPress={onInvite}
        className="bg-wave-surface border border-wave-muted rounded-2xl py-3 px-6 flex-row items-center mt-8"
      >
        <Text className="text-lg mr-2">📲</Text>
        <Text className="text-white font-semibold text-sm">
          {t("radar.inviteFriends")}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
