import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import type { BleAdapterState } from "@/types";

interface BleStatusBarProps {
  adapterState: BleAdapterState;
  isScanning: boolean;
  isAdvertising: boolean;
  error: string | null;
}

export function BleStatusBar({
  adapterState,
  isScanning,
  isAdvertising,
  error,
}: BleStatusBarProps) {
  const { t } = useTranslation();

  if (error) {
    return (
      <View className="bg-wave-danger/20 rounded-xl px-4 py-2 mb-4">
        <Text className="text-wave-danger text-sm">{error}</Text>
      </View>
    );
  }

  if (adapterState === "PoweredOff") {
    return (
      <View className="bg-yellow-900/30 rounded-xl px-4 py-2 mb-4">
        <Text className="text-yellow-400 text-sm">
          {t("bleStatus.bluetoothOff")}
        </Text>
      </View>
    );
  }

  if (adapterState === "Unauthorized") {
    return (
      <View className="bg-wave-danger/20 rounded-xl px-4 py-2 mb-4">
        <Text className="text-wave-danger text-sm">
          {t("bleStatus.unauthorized")}
        </Text>
      </View>
    );
  }

  if (adapterState === "Unsupported") {
    return (
      <View className="bg-wave-danger/20 rounded-xl px-4 py-2 mb-4">
        <Text className="text-wave-danger text-sm">
          {t("bleStatus.unsupported")}
        </Text>
      </View>
    );
  }

  // Normal active state — no status bar needed. The user already knows
  // discovery is running (they pressed Start). Error states above handle
  // actionable problems. Showing "Scanning / Broadcasting" is technical
  // jargon that confuses non-technical users.
  return null;
}
