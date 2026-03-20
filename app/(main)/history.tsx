import { View, Text, TextInput, SectionList, TouchableOpacity, Share, Alert, ActivityIndicator, RefreshControl } from "react-native";
import { useMemo, useEffect, useRef, useCallback, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useMatchStore } from "@/stores/matchStore";
import { useBleStore } from "@/stores/bleStore";
import { removeMatchFromServer, blockUser } from "@/services/wave/waves";
import { fetchMatchesFromServer, loadMoreMatches } from "@/services/wave/matches";
import { openInstagramProfile, openSnapchatProfile } from "@/utils/deepLink";
import { BottomSheet } from "@/components/BottomSheet";
import { SocialActionRow } from "@/components/SocialActionRow";
import { COLORS } from "@/constants/colors";
import { useNearbyMatchIds } from "@/hooks/useNearbyMatchIds";
import type { Match } from "@/types";
import { getAvatarForToken } from "@/types";
import i18n from "@/i18n";

/** Group matches by date with meaningful time buckets */
function groupByDate(matches: Match[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);

  // Start of this week (Monday)
  const dayOfWeek = now.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisWeekStart = new Date(today.getTime() - daysToMonday * 86_400_000);

  // Start of last week
  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 86_400_000);

  const groups: { title: string; data: Match[] }[] = [
    { title: i18n.t("history.today"), data: [] },
    { title: i18n.t("history.yesterday"), data: [] },
    { title: i18n.t("history.thisWeek"), data: [] },
    { title: i18n.t("history.lastWeek"), data: [] },
    { title: i18n.t("history.earlier"), data: [] },
  ];

  // matches are already sorted newest-first by matchStore.getMatchesArray()
  const sorted = matches;

  for (const match of sorted) {
    const d = new Date(match.createdAt);
    if (d >= today) {
      groups[0].data.push(match);
    } else if (d >= yesterday) {
      groups[1].data.push(match);
    } else if (d >= thisWeekStart) {
      groups[2].data.push(match);
    } else if (d >= lastWeekStart) {
      groups[3].data.push(match);
    } else {
      groups[4].data.push(match);
    }
  }

  return groups.filter((g) => g.data.length > 0);
}

export default function HistoryScreen() {
  const { t } = useTranslation();
  const matches = useMatchStore((s) => s.getMatchesArray());
  const nearbyMatchIds = useNearbyMatchIds();
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const filteredMatches = useMemo(() => {
    if (!search.trim()) return matches;
    const q = search.toLowerCase().replace(/^@/, "");
    return matches.filter((m) => {
      const ig = m.instagramHandle?.toLowerCase() ?? "";
      const sc = m.snapchatHandle?.toLowerCase() ?? "";
      return ig.includes(q) || sc.includes(q);
    });
  }, [matches, search]);

  const sections = useMemo(() => groupByDate(filteredMatches), [filteredMatches]);

  // Auto-close action sheet if the match was removed from the store
  // (e.g. the other user blocked/removed us while the sheet was open)
  useEffect(() => {
    if (selectedMatch && !matches.some((m) => m.matchId === selectedMatch.matchId)) {
      setSelectedMatch(null);
    }
  }, [matches, selectedMatch]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchMatchesFromServer();
    setRefreshing(false);
  }, []);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore || matches.length === 0) return;

    // Use oldest match's createdAt as cursor
    const sorted = [...matches].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const cursor = sorted[0].createdAt;

    setLoadingMore(true);
    try {
      const more = await loadMoreMatches(cursor);
      setHasMore(more);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, matches]);

  // Mark all unseen matches as seen only when this tab is FOCUSED (not just mounted).
  // Tab navigators mount all screens simultaneously, so checking isFocused prevents
  // the badge from disappearing before the user actually views the history tab.
  const isFocused = useIsFocused();
  const seenIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isFocused) return;
    const unseen = matches.filter(
      (m) => !m.seen && !seenIdsRef.current.has(m.matchId),
    );
    if (unseen.length > 0) {
      const store = useMatchStore.getState();
      for (const m of unseen) {
        store.markMatchSeen(m.matchId);
        seenIdsRef.current.add(m.matchId);
      }
    }
  }, [matches, isFocused]);

  const handleInvite = async () => {
    try {
      await Share.share({
        message: t("history.shareMessage"),
      });
    } catch {
      // User cancelled share
    }
  };

  return (
    <View className="flex-1 bg-wave-bg pt-16 px-4">
      {/* Header */}
      <View className="flex-row items-center justify-between mb-6">
        <View>
          <Text className="text-3xl font-bold text-white">{t("history.title")}</Text>
          <Text className="text-wave-muted text-sm mt-1">
            {matches.length === 0
              ? t("history.noMatches")
              : t("history.matchCount", { count: matches.length })}
          </Text>
        </View>
      </View>

      {/* Search bar — only show when there are matches */}
      {matches.length > 0 && (
        <View className="bg-wave-surface rounded-2xl flex-row items-center px-4 mb-4" style={{ height: 44 }}>
          <Ionicons name="search" size={16} color={COLORS.muted} style={{ marginRight: 8 }} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t("history.searchMatches")}
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
      )}

      {matches.length === 0 ? (
        <View className="flex-1 items-center justify-center -mt-20">
          <View className="w-20 h-20 rounded-full bg-wave-surface items-center justify-center mb-4">
            <Text className="text-4xl">👋</Text>
          </View>
          <Text className="text-white text-lg font-semibold mb-2">
            {t("history.emptyTitle")}
          </Text>
          <Text className="text-wave-muted text-center text-sm px-8">
            {t("history.emptyDescription")}
          </Text>
          <TouchableOpacity
            onPress={handleInvite}
            className="mt-6 bg-wave-surface border border-wave-muted rounded-2xl py-3 px-6 flex-row items-center"
          >
            <Text className="text-lg mr-2">📲</Text>
            <Text className="text-white font-semibold text-sm">
              {t("history.inviteFriends")}
            </Text>
          </TouchableOpacity>
        </View>
      ) : filteredMatches.length === 0 ? (
        <View className="flex-1 items-center justify-center -mt-20">
          <Ionicons name="search" size={32} color={COLORS.muted} style={{ marginBottom: 12 }} />
          <Text className="text-wave-muted text-sm">{t("history.noSearchResults")}</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.matchId}
          renderSectionHeader={({ section }) => (
            <Text className="text-wave-muted text-xs uppercase tracking-wider mb-2 mt-4">
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => (
            <MatchRow match={item} onPress={setSelectedMatch} isNearby={nearbyMatchIds.has(item.matchedUserId)} />
          )}
          contentContainerStyle={{ paddingBottom: 100 }}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.primary}
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingMore ? (
              <View className="py-4 items-center">
                <ActivityIndicator size="small" color={COLORS.muted} />
              </View>
            ) : null
          }
        />
      )}

      {/* Match action sheet */}
      {selectedMatch && (
        <MatchActionSheet
          match={selectedMatch}
          onClose={() => setSelectedMatch(null)}
        />
      )}
    </View>
  );
}

/* ─── Match Row ─────────────────────────────────────────────── */

function MatchRow({
  match,
  onPress,
  isNearby,
}: {
  match: Match;
  onPress: (match: Match) => void;
  isNearby?: boolean;
}) {
  const { t } = useTranslation();
  const matchDate = new Date(match.createdAt);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const thisWeekStart = new Date(today.getTime() - ((now.getDay() === 0 ? 6 : now.getDay() - 1) * 86_400_000));

  const timeStr = matchDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const matchLabel = matchDate >= today
    ? timeStr
    : matchDate >= yesterday
      ? timeStr
      : matchDate >= thisWeekStart
        ? `${matchDate.toLocaleDateString("en-US", { weekday: "long" })}, ${timeStr}`
        : matchDate.getFullYear() === now.getFullYear()
          ? `${matchDate.toLocaleDateString("en-US", { month: "long", day: "numeric" })}, ${timeStr}`
          : `${matchDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}, ${timeStr}`;

  const igHandle = match.instagramHandle;
  const scHandle = match.snapchatHandle;
  const hasHandle = !!igHandle || !!scHandle;
  const displayName = igHandle ? `@${igHandle}` : scHandle ? scHandle : null;
  const avatar = useMemo(() => getAvatarForToken(match.matchedUserId), [match.matchedUserId]);

  return (
    <TouchableOpacity
      onPress={() => onPress(match)}
      activeOpacity={0.7}
      className="bg-wave-surface rounded-2xl p-4 mb-3 flex-row items-center"
    >
      {/* Avatar — unique per match, derived from matchedUserId */}
      <View className={`w-12 h-12 rounded-full items-center justify-center mr-4 ${avatar.bg} border-2 ${isNearby ? "border-wave-accent" : avatar.ring}`}>
        <Text className="text-lg">{avatar.emoji}</Text>
      </View>

      {/* Info */}
      <View className="flex-1">
        {hasHandle ? (
          <>
            <View className="flex-row items-center">
              <Text className="text-white font-semibold text-base">
                {displayName}
              </Text>
              {isNearby && (
                <View className="bg-wave-accent/15 border border-wave-accent/30 rounded-full px-2 py-0.5 ml-2">
                  <Text className="text-wave-accent text-[10px] font-semibold">{t("history.nearby")}</Text>
                </View>
              )}
            </View>
            <Text className="text-wave-muted text-xs mt-1">
              {t("history.matchedAt", { time: matchLabel })}
            </Text>
          </>
        ) : (
          <>
            <View className="flex-row items-center">
              <Text className="text-white font-semibold text-base">
                {t("history.someoneNearby")}
              </Text>
              {isNearby && (
                <View className="bg-wave-accent/15 border border-wave-accent/30 rounded-full px-2 py-0.5 ml-2">
                  <Text className="text-wave-accent text-[10px] font-semibold">{t("history.nearby")}</Text>
                </View>
              )}
            </View>
            <Text className="text-wave-muted text-xs mt-1">
              {t("history.matchedAt", { time: matchLabel })} · {t("history.noSocials")}
            </Text>
          </>
        )}
      </View>

      {/* Platform indicators or unseen dot */}
      {hasHandle ? (
        <View className="flex-row items-center" style={{ gap: 6 }}>
          {igHandle && <Ionicons name="logo-instagram" size={16} color={COLORS.primary} />}
          {scHandle && <Ionicons name="logo-snapchat" size={16} color={COLORS.snapchat} />}
        </View>
      ) : !match.seen ? (
        <View className="w-3 h-3 rounded-full bg-wave-match" />
      ) : null}
    </TouchableOpacity>
  );
}

/* ─── Match Action Sheet (Modal) ────────────────────────────── */

function MatchActionSheet({
  match,
  onClose,
}: {
  match: Match;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [showReportReasons, setShowReportReasons] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [reportDetails, setReportDetails] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);
  const igHandle = match.instagramHandle;
  const scHandle = match.snapchatHandle;
  const displayName = igHandle ? `@${igHandle}` : scHandle ? scHandle : t("history.someoneNearby");
  const avatar = getAvatarForToken(match.matchedUserId);
  const safeName = displayName !== t("history.someoneNearby") ? displayName : undefined;

  const handleBlock = () => {
    setShowBlockConfirm(true);
  };

  const confirmBlock = async () => {
    setBlocking(true);
    const result = await blockUser({
      blockedId: match.matchedUserId,
      displayName: safeName,
      matchId: match.matchId,
    });
    setBlocking(false);
    setShowBlockConfirm(false);
    onClose();
    if (result.success) {
      useMatchStore.getState().removeMatch(match.matchId);
      useBleStore.getState().removeByUserId(match.matchedUserId);
      useBleStore.getState().addBlockedUserId(match.matchedUserId);
    } else {
      Alert.alert(t("common.error"), t("history.blockError"));
    }
  };

  const handleSubmitReport = async () => {
    if (!selectedReason) return;
    setSubmittingReport(true);
    const result = await blockUser({
      blockedId: match.matchedUserId,
      displayName: safeName,
      matchId: match.matchId,
      reason: selectedReason,
      details: reportDetails.trim() || undefined,
    });
    setSubmittingReport(false);
    setShowReportReasons(false);
    setSelectedReason(null);
    setReportDetails("");
    onClose();
    if (result.success) {
      useMatchStore.getState().removeMatch(match.matchId);
      useBleStore.getState().removeByUserId(match.matchedUserId);
      useBleStore.getState().addBlockedUserId(match.matchedUserId);
      if (result.reportCreated) {
        Alert.alert("", t("history.reportConfirm"));
      }
    } else {
      Alert.alert(t("common.error"), t("history.reportError"));
    }
  };

  const REPORT_REASONS = [
    { key: "harassment", label: t("history.reportReasonHarassment"), icon: "alert-circle-outline" as const },
    { key: "inappropriate", label: t("history.reportReasonInappropriate"), icon: "eye-off-outline" as const },
    { key: "spam", label: t("history.reportReasonSpam"), icon: "bug-outline" as const },
    { key: "other", label: t("history.reportReasonOther"), icon: "ellipsis-horizontal-outline" as const },
  ];

  return (
    <BottomSheet visible onClose={() => { setShowReportReasons(false); setShowBlockConfirm(false); setShowRemoveConfirm(false); onClose(); }}>
      {showRemoveConfirm ? (
        <>
          {/* Remove match confirmation */}
          <View className="items-center mb-5">
            <Ionicons name="trash" size={32} color={COLORS.danger} style={{ marginBottom: 12 }} />
            <Text className="text-white text-lg font-semibold">
              {t("history.removeMatch")}
            </Text>
            <Text className="text-wave-muted text-sm mt-2 text-center px-4">
              {t("history.removeConfirm", { name: displayName })}
            </Text>
          </View>

          <TouchableOpacity
            onPress={async () => {
              setRemoving(true);
              const success = await removeMatchFromServer(match.matchId);
              setRemoving(false);
              setShowRemoveConfirm(false);
              onClose();
              if (success) {
                useMatchStore.getState().removeMatch(match.matchId);
              } else {
                Alert.alert(t("common.error"), t("history.removeError"));
              }
            }}
            disabled={removing}
            className="w-full bg-wave-danger rounded-2xl py-4 items-center justify-center mb-2"
            activeOpacity={0.8}
          >
            {removing ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Text className="text-white text-sm font-semibold">{t("common.remove")}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setShowRemoveConfirm(false)}
            className="items-center py-2"
            activeOpacity={0.7}
          >
            <Text className="text-wave-muted text-sm">{t("common.cancel")}</Text>
          </TouchableOpacity>
        </>
      ) : showBlockConfirm ? (
        <>
          {/* Block confirmation */}
          <View className="items-center mb-5">
            <Ionicons name="ban" size={32} color={COLORS.danger} style={{ marginBottom: 12 }} />
            <Text className="text-white text-lg font-semibold">
              {t("history.blockUser")}
            </Text>
            <Text className="text-wave-muted text-sm mt-2 text-center px-4">
              {t("history.blockConfirm", { name: displayName })}
            </Text>
          </View>

          <TouchableOpacity
            onPress={confirmBlock}
            disabled={blocking}
            className="w-full bg-wave-danger rounded-2xl py-4 items-center justify-center mb-2"
            activeOpacity={0.8}
          >
            {blocking ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Text className="text-white text-sm font-semibold">{t("history.blockAndRemove")}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setShowBlockConfirm(false)}
            className="items-center py-2"
            activeOpacity={0.7}
          >
            <Text className="text-wave-muted text-sm">{t("common.cancel")}</Text>
          </TouchableOpacity>
        </>
      ) : showReportReasons ? (
        <>
          {/* Report reason picker */}
          <View className="items-center mb-5">
            <Ionicons name="flag" size={32} color={COLORS.danger} style={{ marginBottom: 12 }} />
            <Text className="text-white text-lg font-semibold">
              {t("history.reportTitle", { name: displayName })}
            </Text>
            <Text className="text-wave-muted text-sm mt-2 text-center">
              {t("history.reportReasonPrompt")}
            </Text>
          </View>

          {/* Reason selection (single choice) */}
          <View style={{ gap: 6 }} className="mb-4">
            {REPORT_REASONS.map((reason) => {
              const isSelected = selectedReason === reason.key;
              return (
                <TouchableOpacity
                  key={reason.key}
                  onPress={() => setSelectedReason(reason.key)}
                  className={`rounded-xl py-3 px-4 flex-row items-center border ${
                    isSelected ? "bg-wave-primary/15 border-wave-primary/30" : "bg-wave-bg border-transparent"
                  }`}
                  activeOpacity={0.7}
                >
                  <Ionicons name={reason.icon} size={20} color={isSelected ? COLORS.primary : COLORS.text} style={{ marginRight: 12 }} />
                  <Text className={`text-sm font-semibold flex-1 ${isSelected ? "text-white" : "text-wave-muted"}`}>{reason.label}</Text>
                  {isSelected && <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Optional details */}
          {selectedReason && (
            <View className="bg-wave-bg rounded-xl px-4 mb-4" style={{ height: 80 }}>
              <TextInput
                value={reportDetails}
                onChangeText={setReportDetails}
                placeholder={t("history.reportDetailsPlaceholder")}
                placeholderTextColor={COLORS.placeholder}
                multiline
                className="flex-1 text-white text-sm"
                style={{ paddingVertical: 12, textAlignVertical: "top" }}
                maxLength={500}
              />
            </View>
          )}

          {/* Submit */}
          <TouchableOpacity
            onPress={handleSubmitReport}
            disabled={!selectedReason || submittingReport}
            className={`w-full rounded-2xl py-4 items-center justify-center mb-2 ${selectedReason ? "bg-wave-danger" : "bg-wave-danger/30"}`}
            activeOpacity={0.8}
          >
            {submittingReport ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Text className={`text-sm font-semibold ${selectedReason ? "text-white" : "text-wave-muted"}`}>
                {t("history.submitReport")}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => { setShowReportReasons(false); setSelectedReason(null); setReportDetails(""); }}
            className="items-center py-2"
            activeOpacity={0.7}
          >
            <Text className="text-wave-muted text-sm">{t("common.cancel")}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          {/* Match info */}
          <View className="items-center mb-5">
            <View className={`w-14 h-14 rounded-full items-center justify-center mb-3 ${avatar.bg} border-2 ${avatar.ring}`}>
              <Text className="text-2xl">{avatar.emoji}</Text>
            </View>
            <Text className="text-white text-lg font-semibold">{displayName}</Text>
          </View>

          {/* Contact options */}
          <View style={{ gap: 8 }}>
            {igHandle && (
              <SocialActionRow
                platform="instagram"
                handle={igHandle}
                onPress={() => { onClose(); openInstagramProfile(igHandle); }}
              />
            )}
            {scHandle && (
              <SocialActionRow
                platform="snapchat"
                handle={scHandle}
                onPress={() => { onClose(); openSnapchatProfile(scHandle); }}
              />
            )}
          </View>

          {/* Divider */}
          <View className="h-px bg-wave-muted/20 my-3" />

          {/* Remove Match */}
          <TouchableOpacity
            onPress={() => setShowRemoveConfirm(true)}
            className="bg-wave-bg rounded-xl py-3.5 px-4 mb-2 flex-row items-center"
            activeOpacity={0.7}
            accessibilityLabel={t("history.removeMatch")}
            accessibilityRole="button"
          >
            <Ionicons name="trash-outline" size={20} color={COLORS.text} style={{ marginRight: 12 }} />
            <Text className="text-wave-text text-sm font-semibold">{t("history.removeMatch")}</Text>
          </TouchableOpacity>

          {/* Block */}
          <TouchableOpacity
            onPress={handleBlock}
            className="bg-wave-bg rounded-xl py-3.5 px-4 mb-2 flex-row items-center"
            activeOpacity={0.7}
            accessibilityLabel={t("history.blockUser")}
            accessibilityRole="button"
          >
            <Ionicons name="ban-outline" size={20} color={COLORS.danger} style={{ marginRight: 12 }} />
            <Text className="text-wave-danger text-sm font-semibold">{t("history.blockUser")}</Text>
          </TouchableOpacity>

          {/* Report & Block */}
          <TouchableOpacity
            onPress={() => setShowReportReasons(true)}
            className="bg-wave-bg rounded-xl py-3.5 px-4 mb-2 flex-row items-center"
            activeOpacity={0.7}
            accessibilityLabel={t("history.reportUser")}
            accessibilityRole="button"
          >
            <Ionicons name="flag-outline" size={20} color={COLORS.danger} style={{ marginRight: 12 }} />
            <Text className="text-wave-danger text-sm font-semibold">{t("history.reportUser")}</Text>
          </TouchableOpacity>
        </>
      )}
    </BottomSheet>
  );
}
