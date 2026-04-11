import { useCallback, useRef, useState } from "react";
import { View, Text, LayoutChangeEvent } from "react-native";
import { useTranslation } from "react-i18next";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
  clamp,
} from "react-native-reanimated";

const THUMB_SIZE = 24;
const TRACK_HEIGHT = 4;
const MIN_AGE = 18;
const MAX_AGE = 80;
const AGE_RANGE = MAX_AGE - MIN_AGE;

interface AgeRangeSliderProps {
  min: number;
  max: number;
  onChangeEnd: (min: number, max: number) => void;
}

export function AgeRangeSlider({ min, max, onChangeEnd }: AgeRangeSliderProps) {
  const { t } = useTranslation();
  const trackWidth = useSharedValue(0);

  // Position as fraction (0-1)
  const minFrac = useSharedValue((min - MIN_AGE) / AGE_RANGE);
  const maxFrac = useSharedValue((max - MIN_AGE) / AGE_RANGE);

  // React state for label display (updated via runOnJS during drag)
  const [displayMin, setDisplayMin] = useState(min);
  const [displayMax, setDisplayMax] = useState(max);

  const commitRef = useRef(onChangeEnd);
  commitRef.current = onChangeEnd;

  const commit = useCallback((lo: number, hi: number) => {
    commitRef.current(lo, hi);
  }, []);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      trackWidth.value = e.nativeEvent.layout.width;
    },
    [trackWidth],
  );

  // --- Min thumb gesture ---
  const minStart = useSharedValue(0);
  const minGesture = Gesture.Pan()
    .onBegin(() => {
      minStart.value = minFrac.value;
    })
    .onUpdate((e) => {
      const w = trackWidth.value;
      if (w === 0) return;
      const newFrac = clamp(
        minStart.value + e.translationX / w,
        0,
        maxFrac.value - 1 / AGE_RANGE,
      );
      minFrac.value = newFrac;
      const age = Math.round(newFrac * AGE_RANGE + MIN_AGE);
      runOnJS(setDisplayMin)(age);
    })
    .onEnd(() => {
      const lo = Math.round(minFrac.value * AGE_RANGE + MIN_AGE);
      const hi = Math.round(maxFrac.value * AGE_RANGE + MIN_AGE);
      runOnJS(commit)(lo, hi);
    });

  // --- Max thumb gesture ---
  const maxStart = useSharedValue(0);
  const maxGesture = Gesture.Pan()
    .onBegin(() => {
      maxStart.value = maxFrac.value;
    })
    .onUpdate((e) => {
      const w = trackWidth.value;
      if (w === 0) return;
      const newFrac = clamp(
        maxStart.value + e.translationX / w,
        minFrac.value + 1 / AGE_RANGE,
        1,
      );
      maxFrac.value = newFrac;
      const age = Math.round(newFrac * AGE_RANGE + MIN_AGE);
      runOnJS(setDisplayMax)(age);
    })
    .onEnd(() => {
      const lo = Math.round(minFrac.value * AGE_RANGE + MIN_AGE);
      const hi = Math.round(maxFrac.value * AGE_RANGE + MIN_AGE);
      runOnJS(commit)(lo, hi);
    });

  // --- Animated styles ---
  const minThumbStyle = useAnimatedStyle(() => ({
    left: minFrac.value * trackWidth.value - THUMB_SIZE / 2,
  }));

  const maxThumbStyle = useAnimatedStyle(() => ({
    left: maxFrac.value * trackWidth.value - THUMB_SIZE / 2,
  }));

  const activeTrackStyle = useAnimatedStyle(() => ({
    left: minFrac.value * trackWidth.value,
    width: (maxFrac.value - minFrac.value) * trackWidth.value,
  }));

  return (
    <View>
      {/* Range display */}
      <View className="flex-row justify-between mb-2">
        <Text className="text-white text-sm font-semibold">{displayMin}</Text>
        <Text className="text-wave-muted text-xs self-center">{t("gender.ageRange")}</Text>
        <Text className="text-white text-sm font-semibold">{displayMax}</Text>
      </View>

      {/* Track container */}
      <View
        className="justify-center"
        style={{ height: THUMB_SIZE + 8, paddingHorizontal: THUMB_SIZE / 2 }}
      >
        {/* Background track */}
        <View
          onLayout={onLayout}
          className="bg-wave-bg rounded-full"
          style={{ height: TRACK_HEIGHT }}
        >
          {/* Active (selected) track */}
          <Animated.View
            className="absolute bg-wave-primary rounded-full"
            style={[{ height: TRACK_HEIGHT }, activeTrackStyle]}
          />
        </View>

        {/* Min thumb */}
        <GestureDetector gesture={minGesture}>
          <Animated.View
            className="absolute bg-white rounded-full border-2 border-wave-primary"
            style={[
              {
                width: THUMB_SIZE,
                height: THUMB_SIZE,
                top: 4 - TRACK_HEIGHT / 2,
              },
              minThumbStyle,
            ]}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          />
        </GestureDetector>

        {/* Max thumb */}
        <GestureDetector gesture={maxGesture}>
          <Animated.View
            className="absolute bg-white rounded-full border-2 border-wave-primary"
            style={[
              {
                width: THUMB_SIZE,
                height: THUMB_SIZE,
                top: 4 - TRACK_HEIGHT / 2,
              },
              maxThumbStyle,
            ]}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          />
        </GestureDetector>
      </View>

      {/* Bounds labels */}
      <View className="flex-row justify-between mt-1">
        <Text className="text-wave-muted text-xs">{MIN_AGE}</Text>
        <Text className="text-wave-muted text-xs">{MAX_AGE}</Text>
      </View>
    </View>
  );
}
