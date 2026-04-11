import { useState, useCallback, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheet } from "@/components/BottomSheet";
import { supabase } from "@/services/supabase";
import { COLORS } from "@/constants/colors";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function SupportTicketSheet({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when sheet opens
  useEffect(() => {
    if (visible) {
      setCategory(null);
      setDetails("");
      setConfirmed(false);
      setError(null);
    }
  }, [visible]);

  const handleClose = useCallback(() => {
    onClose();
    // Reset form AFTER sheet animation completes so the form doesn't flash
    setTimeout(() => {
      setCategory(null);
      setDetails("");
      setConfirmed(false);
      setError(null);
    }, 300);
  }, [onClose]);

  const handleSubmit = async () => {
    if (!category) return;
    setSubmitting(true);
    setError(null);
    try {
      // Store ticket in DB (rate limited, structured, auditable)
      const { error: rpcError } = await supabase.rpc("create_support_ticket", {
        p_category: category,
        p_details: details.trim() || null,
      });
      if (rpcError) {
        setSubmitting(false);
        const isRateLimited = rpcError.message?.includes("rate_limited");
        setError(isRateLimited ? t("settings.ticketRateLimited") : t("settings.ticketError"));
        return;
      }

      // Send email notification (non-blocking — ticket is saved even if email fails)
      supabase.functions.invoke("send-support-email", {
        body: {
          category,
          details: details.trim() || null,
          device: {
            appVersion: Constants.expoConfig?.version ?? "unknown",
            platform: Platform.OS,
            osVersion: Platform.Version,
            deviceName: Constants.deviceName ?? "unknown",
          },
        },
      }).catch(() => {
        // Email failed silently — ticket is still in DB
      });

      setSubmitting(false);
      setConfirmed(true);
    } catch {
      setSubmitting(false);
      setError(t("settings.ticketError"));
    }
  };

  return (
    <BottomSheet visible={visible} onClose={handleClose}>
      {confirmed ? (
        <>
          <View className="items-center mb-6">
            <View className="w-16 h-16 rounded-full bg-wave-accent/20 items-center justify-center mb-4">
              <Ionicons name="checkmark-circle" size={36} color={COLORS.accent} />
            </View>
            <Text className="text-white text-lg font-semibold mb-2">{t("settings.ticketConfirmedTitle")}</Text>
            <Text className="text-wave-muted text-sm text-center px-4">{t("settings.ticketConfirmedBody")}</Text>
          </View>
          <TouchableOpacity
            onPress={handleClose}
            className="w-full bg-wave-primary rounded-2xl py-4 items-center"
            activeOpacity={0.8}
          >
            <Text className="text-white text-sm font-semibold">{t("common.done")}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View className="items-center mb-5">
            <Ionicons name="chatbubble-ellipses-outline" size={32} color={COLORS.primary} style={{ marginBottom: 12 }} />
            <Text className="text-white text-lg font-semibold">{t("settings.supportTitle")}</Text>
            <Text className="text-wave-muted text-sm mt-2 text-center">{t("settings.supportDescription")}</Text>
          </View>

          <View style={{ gap: 6 }} className="mb-4">
            {[
              { key: "bug", label: t("settings.supportBugReport"), icon: "bug-outline" as const },
              { key: "account", label: t("settings.supportAccountIssue"), icon: "person-outline" as const },
              { key: "feature", label: t("settings.supportFeatureRequest"), icon: "bulb-outline" as const },
              { key: "other", label: t("settings.supportOther"), icon: "ellipsis-horizontal-outline" as const },
            ].map((item) => {
              const isSelected = category === item.key;
              return (
                <TouchableOpacity
                  key={item.key}
                  onPress={() => setCategory(item.key)}
                  className={`rounded-xl py-3 px-4 flex-row items-center border ${
                    isSelected ? "bg-wave-primary/15 border-wave-primary/30" : "bg-wave-bg border-transparent"
                  }`}
                  activeOpacity={0.7}
                >
                  <Ionicons name={item.icon} size={20} color={isSelected ? COLORS.primary : COLORS.text} style={{ marginRight: 12 }} />
                  <Text className={`text-sm font-semibold flex-1 ${isSelected ? "text-white" : "text-wave-muted"}`}>{item.label}</Text>
                  {isSelected && <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {category && (
            <View className="bg-wave-bg rounded-xl px-4 mb-4" style={{ height: 80 }}>
              <TextInput
                value={details}
                onChangeText={setDetails}
                placeholder={t("settings.supportDetailsPlaceholder")}
                placeholderTextColor={COLORS.placeholder}
                multiline
                className="flex-1 text-white text-sm"
                style={{ paddingVertical: 12, textAlignVertical: "top" }}
                maxLength={1000}
              />
            </View>
          )}

          {error && (
            <View className="bg-wave-danger/15 border border-wave-danger/30 rounded-xl px-4 py-3 mb-3">
              <Text className="text-wave-danger text-sm text-center">{error}</Text>
            </View>
          )}

          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!category || submitting}
            className={`w-full rounded-2xl py-4 items-center justify-center mb-2 ${category ? "bg-wave-primary" : "bg-wave-primary/30"}`}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Text className={`text-sm font-semibold ${category ? "text-white" : "text-wave-muted"}`}>
                {t("settings.submitTicket")}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleClose}
            className="items-center py-2"
            activeOpacity={0.7}
          >
            <Text className="text-wave-muted text-sm">{t("common.cancel")}</Text>
          </TouchableOpacity>
        </>
      )}
    </BottomSheet>
  );
}
