import { useEffect } from "react";
import { View, Text } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
} from "react-native-reanimated";
import { COLORS } from "@/constants/colors";

function PulseRing({ delay, color }: { delay: number; color: string }) {
  const scale = useSharedValue(0.3);
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    scale.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: 2400, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      ),
    );
    opacity.value = withDelay(
      delay,
      withRepeat(
        withTiming(0, { duration: 2400, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      ),
    );
  }, [delay, scale, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: 140,
          height: 140,
          borderRadius: 70,
          borderWidth: 2,
          borderColor: color,
        },
        animatedStyle,
      ]}
    />
  );
}

export function ScanPulse() {
  return (
    <View className="w-36 h-36 items-center justify-center">
      <PulseRing delay={0} color={COLORS.primary + "59"} />
      <PulseRing delay={800} color={COLORS.primary + "59"} />
      <PulseRing delay={1600} color={COLORS.primary + "59"} />
      <View className="w-16 h-16 rounded-full bg-wave-primary/20 items-center justify-center border-2 border-wave-primary/40">
        <Text className="text-3xl">📡</Text>
      </View>
    </View>
  );
}
