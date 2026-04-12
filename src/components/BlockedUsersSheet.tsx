import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheet } from "@/components/BottomSheet";
import { useBleStore } from "@/stores/bleStore";
import { getBlockedUsers, unblockUser } from "@/services/wave/waves";
import { getFakeBlockedUsers } from "@/utils/seedPeers";
import { COLORS } from "@/constants/colors";
import type { ToastVariant } from "@/components/Toast";

type BlockedUser = {
  blockedId: string;
  displayName: string | null;
  createdAt: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  showToast: (msg: string, variant?: ToastVariant) => void;
};

function formatDateTime(date: Date, locale: string): string {
  const dateStr = date.toLocaleDateString(locale, { month: "long", day: "numeric", year: "numeric" });
  const timeStr = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${dateStr}, ${timeStr}`;
}

export function BlockedUsersSheet({ visible, onClose, showToast }: Props) {
  const { t, i18n } = useTranslation();
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [unblockTarget, setUnblockTarget] = useState<{ blockedId: string; displayName: string | null } | null>(null);
  const [unblocking, setUnblocking] = useState(false);
  const [search, setSearch] = useState("");

  const loadBlockedUsers = useCallback(() => {
    setLoading(true);
    getBlockedUsers().then((users) => {
      setBlockedUsers(users.length > 0 || !__DEV__ ? users : getFakeBlockedUsers());
      setLoading(false);
    }).catch(() => {
      setLoading(false);
      showToast(t("settings.genericError"), "error");
    });
  }, [showToast, t]);

  // Load blocked users when the sheet opens
  useEffect(() => {
    if (visible) {
      setUnblockTarget(null);
      setSearch("");
      loadBlockedUsers();
    }
  }, [visible, loadBlockedUsers]);

  const handleClose = useCallback(() => {
    onClose();
    setSearch("");
  }, [onClose]);

  const handleUnblock = (blockedId: string, displayName: string | null) => {
    setUnblockTarget({ blockedId, displayName });
  };

  const confirmUnblock = async () => {
    if (!unblockTarget) return;
    setUnblocking(true);
    const success = await unblockUser(unblockTarget.blockedId);
    setUnblocking(false);
    if (success) {
      setBlockedUsers((prev) => prev.filter((u) => u.blockedId !== unblockTarget.blockedId));
      useBleStore.getState().removeBlockedUserId(unblockTarget.blockedId);
      // Evict stale peer entries so BLE rediscovery creates fresh ones.
      // useNoteResolver's subscriber detects new unresolved tokens and
      // triggers a fast resolution tick (~1s), making the peer reappear
      // on radar within seconds instead of waiting up to 60s.
      useBleStore.getState().removeByUserId(unblockTarget.blockedId);
      setUnblockTarget(null);
      showToast(t("settings.unblocked"));
    } else {
      showToast(t("settings.unblockError"), "error");
    }
  };

  return (
    <BottomSheet visible={visible} onClose={handleClose}>
      {unblockTarget ? (
        <>
          {/* Unblock confirmation (inline, same BottomSheet) */}
          <View className="items-center mb-5">
            <Ionicons name="shield-checkmark-outline" size={32} color={COLORS.primary} style={{ marginBottom: 12 }} />
            <Text className="text-white text-lg font-semibold">
              {t("settings.unblock")}
            </Text>
            <Text className="text-wave-muted text-sm mt-2 text-center px-4">
              {t("settings.unblockConfirm", { name: unblockTarget.displayName || t("history.someoneNearby") })}
            </Text>
          </View>

          <TouchableOpacity
            onPress={confirmUnblock}
            disabled={unblocking}
            className="w-full bg-wave-primary rounded-2xl py-4 items-center justify-center mb-2"
            activeOpacity={0.8}
          >
            {unblocking ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Text className="text-white text-sm font-semibold">{t("settings.unblock")}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setUnblockTarget(null)}
            className="items-center py-2"
            activeOpacity={0.7}
          >
            <Text className="text-wave-muted text-sm">{t("common.cancel")}</Text>
          </TouchableOpacity>
        </>
      ) : loading ? (
        <View className="items-center py-8">
          <ActivityIndicator size="small" color={COLORS.primary} />
        </View>
      ) : (
        <>
          <Text className="text-white text-lg font-semibold text-center mb-1">{t("settings.blockedUsers")}</Text>
          {blockedUsers.length > 0 && (
            <Text className="text-wave-muted text-xs text-center mb-3">{t("settings.blockedCount", { count: blockedUsers.length })}</Text>
          )}
          {blockedUsers.length === 0 ? (
            <Text className="text-wave-muted text-sm text-center py-8">{t("settings.noBlockedUsers")}</Text>
          ) : (() => {
            const q = search.toLowerCase().replace(/^@/, "");
            const filtered = q
              ? blockedUsers.filter((u) => u.displayName?.toLowerCase().replace(/^@/, "").includes(q))
              : blockedUsers;
            return (
              <>
                {/* Search */}
                <View className="bg-wave-bg rounded-xl flex-row items-center px-3 mb-3" style={{ height: 40 }}>
                  <Ionicons name="search" size={16} color={COLORS.muted} style={{ marginRight: 8 }} />
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder={t("settings.searchBlocked")}
                    placeholderTextColor={COLORS.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="flex-1 text-white text-sm"
                    style={{ paddingVertical: 0 }}
                  />
                  {search.length > 0 && (
                    <TouchableOpacity onPress={() => setSearch("")} className="pl-2">
                      <Ionicons name="close-circle" size={16} color={COLORS.muted} />
                    </TouchableOpacity>
                  )}
                </View>

                {filtered.length === 0 ? (
                  <Text className="text-wave-muted text-sm text-center py-6">{t("settings.noSearchResults")}</Text>
                ) : (
                  <ScrollView
                    style={{ maxHeight: 350 }}
                    showsVerticalScrollIndicator
                    indicatorStyle="white"
                    refreshControl={
                      <RefreshControl
                        refreshing={loading}
                        onRefresh={loadBlockedUsers}
                        tintColor={COLORS.primary}
                      />
                    }
                  >
                    <View style={{ gap: 8 }}>
                      {filtered.map((user) => (
                        <View key={user.blockedId} className="bg-wave-bg rounded-xl py-3 px-4 flex-row items-center justify-between">
                          <View className="flex-1 mr-3">
                            <Text className="text-white text-sm font-semibold">
                              {user.displayName || t("history.someoneNearby")}
                            </Text>
                            <Text className="text-wave-muted text-xs mt-0.5">
                              {formatDateTime(new Date(user.createdAt), i18n.language)}
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => handleUnblock(user.blockedId, user.displayName)}
                            className="bg-wave-primary/15 border border-wave-primary/30 rounded-lg px-4 py-2"
                            activeOpacity={0.7}
                          >
                            <Text className="text-wave-primary text-xs font-semibold">{t("settings.unblock")}</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                )}
              </>
            );
          })()}
        </>
      )}
    </BottomSheet>
  );
}
