import { useEffect } from "react";
import { View } from "react-native";
import { COLORS } from "@/constants/colors";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";

const TOTAL_STEPS = 5;

/**
 * Minimal progress bar for the onboarding flow.
 * Thin segmented bar — current segment animates its fill.
 * Matches the progress bar pattern used by Tinder/Bumble/Hinge.
 */
export function OnboardingProgress({ step }: { step: number }) {
  return (
    <View className="flex-row w-full mb-10" style={{ gap: 4 }}>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <Segment key={i} state={i + 1 < step ? "done" : i + 1 === step ? "active" : "pending"} />
      ))}
    </View>
  );
}

function Segment({ state }: { state: "done" | "active" | "pending" }) {
  const fill = useSharedValue(state === "done" ? 1 : 0);

  useEffect(() => {
    if (state === "active") {
      fill.value = 0;
      fill.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) });
    } else if (state === "done") {
      fill.value = withTiming(1, { duration: 150 });
    } else {
      fill.value = 0;
    }
  }, [state, fill]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fill.value * 100}%` as any,
  }));

  return (
    <View className="flex-1 rounded-full overflow-hidden" style={{ height: 3, backgroundColor: "rgba(102, 102, 128, 0.15)" }}>
      <Animated.View className="rounded-full" style={[{ height: 3, backgroundColor: COLORS.primary }, fillStyle]} />
    </View>
  );
}
