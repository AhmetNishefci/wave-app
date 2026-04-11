import { useEffect, useRef } from "react";
import { Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { COLORS } from "@/constants/colors";

export type ToastVariant = "success" | "error";

interface ToastProps {
  message: string | null;
  variant?: ToastVariant;
  onDismiss: () => void;
  durationMs?: number;
}

const variantStyles: Record<ToastVariant, { bg: string; borderColor: string }> = {
  success: { bg: "bg-green-900", borderColor: COLORS.toastSuccess },
  error: { bg: "bg-red-900", borderColor: COLORS.toastError },
};

/**
 * Auto-dismissing toast notification using Reanimated.
 * Renders as an absolute-positioned overlay at the top of the screen.
 */
export function Toast({ message, variant = "success", onDismiss, durationMs = 2000 }: ToastProps) {
  const insets = useSafeAreaInsets();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!message) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onDismissRef.current(), durationMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [message, durationMs]);

  if (!message) return null;

  const { bg, borderColor } = variantStyles[variant];

  return (
    <Animated.View
      key={`${message}-${variant}`}
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      style={{ top: insets.top + 8, borderColor }}
      className={`absolute left-4 right-4 z-50 ${bg} border rounded-2xl py-3 px-4`}
    >
      <Text className="text-white text-sm text-center font-medium">{message}</Text>
    </Animated.View>
  );
}
