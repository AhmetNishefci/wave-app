import { Modal, TouchableWithoutFeedback, View, KeyboardAvoidingView, Platform } from "react-native";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Shared bottom sheet modal with backdrop dismiss.
 * Tap outside the sheet to close. Keyboard-aware — content shifts up
 * when the keyboard opens so inputs remain visible.
 *
 * Uses TouchableWithoutFeedback for the backdrop (doesn't capture scroll)
 * and a plain View for the sheet body (allows ScrollView inside children).
 */
export function BottomSheet({ visible, onClose, children }: BottomSheetProps) {
  const { t } = useTranslation();
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <View className="flex-1 bg-black/60 justify-end">
          {/* Backdrop — tapping this area dismisses */}
          <TouchableWithoutFeedback onPress={onClose} accessibilityLabel={t("common.cancel")} accessibilityRole="button">
            <View className="flex-1" />
          </TouchableWithoutFeedback>

          {/* Sheet body — does NOT capture scroll gestures */}
          <View className="bg-wave-surface rounded-t-3xl px-6 pt-6 pb-10">
            {/* Handle bar */}
            <View className="w-10 h-1 rounded-full bg-wave-muted/40 self-center mb-5" />
            {children}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
