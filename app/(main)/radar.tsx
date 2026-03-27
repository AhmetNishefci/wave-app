import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Share,
  RefreshControl,
} from "react-native";
import { useTranslation } from "react-i18next";
import Animated, {
  FadeIn,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { impactMedium, impactLight, notifySuccess, notifyError } from "@/utils/haptics";
import { useBleStore } from "@/stores/bleStore";
import { useWaveStore } from "@/stores/waveStore";
import { useTokenStore } from "@/stores/tokenStore";
import { useMatchStore } from "@/stores/matchStore";
import { useAuthStore } from "@/stores/authStore";
import { waveBleManager } from "@/services/ble/bleManager";
import { sendWave, undoWave } from "@/services/wave/waves";
import { PermissionGate } from "@/components/PermissionGate";
import { BleStatusBar } from "@/components/StatusBar";
import { Toast } from "@/components/Toast";
import { PeerRow } from "@/components/PeerRow";
import { PeerDetailModal } from "@/components/PeerDetailModal";
import { ScanPulse } from "@/components/ScanPulse";
import type { NearbyPeer } from "@/types";
import { logger } from "@/utils/logger";
import { playWaveSent } from "@/utils/sound";
import { useNoteResolver } from "@/hooks/useNoteResolver";
import { clearWaveStateForUser } from "@/utils/waveCleanup";
import { seedFakePeers, clearFakePeers, seedFakeMatches, triggerFakeMatch, clearFakeMatches } from "@/utils/seedPeers";
import { getCurrentLocation, updateLocationOnServer } from "@/services/location";
import { showPermissionBlockedAlert } from "@/services/ble/permissions";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { saveNote } from "@/services/profile";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";

const PEER_DISPLAY_CAP = 50;

/** Subtle pulsing dot — signals the radar is live when peers are visible */
function LiveDot() {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.3, { duration: 1200 }), -1, true);
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={style}
      className="w-2 h-2 rounded-full bg-green-400 mr-2"
    />
  );
}


export default function RadarScreen() {
  const { t } = useTranslation();
  const {
    adapterState,
    isScanning,
    isDiscoveryActive,
    isAdvertising,
    permissionStatus,
    nearbyPeers,
    blockedUserIds,
    error,
    proximityAlertPending,
  } = useBleStore();
  const { currentToken } = useTokenStore();
  const rawIncomingWaveTokens = useWaveStore((s) => s.incomingWaveTokens);
  const matchesById = useMatchStore((s) => s.matchesById);
  const myGender = useAuthStore((s) => s.gender);
  const myAge = useAuthStore((s) => s.age);
  const genderPreference = useAuthStore((s) => s.genderPreference);
  const agePreferenceMin = useAuthStore((s) => s.agePreferenceMin);
  const agePreferenceMax = useAuthStore((s) => s.agePreferenceMax);
  const { isConnected } = useNetworkStatus();

  // Filter peers by mutual preferences — both users must match each other's criteria.
  // This prevents one-sided visibility where A sees B but B can't see A.
  const filteredPeers = useMemo(() => {
    const filtered = new Map<string, NearbyPeer>();
    const seenUserIds = new Map<string, string>(); // userId → token (for dedup)
    const filterGender = genderPreference && genderPreference !== "both";
    const filterAge = agePreferenceMin != null && agePreferenceMax != null;

    for (const [token, peer] of nearbyPeers) {
      // Resolution gate: only show peers whose userId has been resolved.
      // This guarantees zero duplicates (dedup by userId is reliable) and
      // ensures all filters (block, match, preference) work immediately.
      // Peers appear ~1s after BLE discovery (fast resolution tick).
      if (!peer.userId) continue;

      // Block filter: hide peers whose userId is in the blocked set
      if (blockedUserIds.has(peer.userId)) {
        continue;
      }
      // Match filter: hide already-matched peers (they belong in History)
      {
        let isMatched = false;
        for (const m of matchesById.values()) {
          if (m.matchedUserId === peer.userId) { isMatched = true; break; }
        }
        if (isMatched) continue;
      }
      // Forward filter: does this peer match MY preferences?
      if (filterGender && peer.gender && peer.gender !== genderPreference) {
        continue;
      }
      if (filterAge && peer.age != null) {
        if (peer.age < agePreferenceMin || peer.age > agePreferenceMax) {
          continue;
        }
      }
      // Reverse filter: do I match THIS PEER's preferences?
      // Only apply when the peer's preferences have been resolved from the server.
      if (peer.genderPreference && peer.genderPreference !== "both" && myGender) {
        if (myGender !== peer.genderPreference) {
          continue;
        }
      }
      if (peer.agePreferenceMin != null && peer.agePreferenceMax != null && myAge != null) {
        if (myAge < peer.agePreferenceMin || myAge > peer.agePreferenceMax) {
          continue;
        }
      }
      // Dedup by userId: if we already have a peer with this userId, keep the fresher one
      if (peer.userId) {
        const existingToken = seenUserIds.get(peer.userId);
        if (existingToken) {
          const existingPeer = filtered.get(existingToken)!;
          if (peer.lastSeen > existingPeer.lastSeen) {
            filtered.delete(existingToken);
            seenUserIds.set(peer.userId, token);
          } else {
            continue;
          }
        } else {
          seenUserIds.set(peer.userId, token);
        }
      }
      filtered.set(token, peer);
    }

    return filtered;
  }, [nearbyPeers, blockedUserIds, matchesById, myGender, myAge, genderPreference, agePreferenceMin, agePreferenceMax]);

  // Only count incoming waves from wavers still visible on the radar
  // AND matching gender preference (prevent phantom wave notifications).
  const incomingWaveTokens = useMemo(
    () => rawIncomingWaveTokens.filter((t) => filteredPeers.has(t)),
    [rawIncomingWaveTokens, filteredPeers],
  );
  const [isStarting, setIsStarting] = useState(false);
  const startingRef = useRef(false);
  const [toast, setToast] = useState<{ message: string; variant?: "success" | "error" } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPeer, setSelectedPeer] = useState<NearbyPeer | null>(null);
  const [showAllPeers, setShowAllPeers] = useState(false);

  // Inline note editor
  const currentNote = useAuthStore((s) => s.note);
  const [editingNote, setEditingNote] = useState(false);
  const [noteInput, setNoteInput] = useState(currentNote ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const savingNoteRef = useRef(false);
  const noteInputRef = useRef<TextInput>(null);

  // Resolve peer notes from server
  useNoteResolver(isDiscoveryActive);

  const handleSaveNote = useCallback(async () => {
    if (savingNoteRef.current) return;
    savingNoteRef.current = true;

    const trimmed = noteInput.trim();
    setSavingNote(true);
    impactLight();

    const success = await saveNote(trimmed || null);
    setSavingNote(false);
    savingNoteRef.current = false;

    if (success) {
      useAuthStore.getState().setNote(trimmed || null);
      setEditingNote(false);
    } else {
      setToast({ message: t("radar.couldntUpdateNote"), variant: "error" });
    }
  }, [noteInput]);

  const handleRefresh = useCallback(async () => {
    if (!isDiscoveryActive) return;
    setRefreshing(true);
    // Restart scan cycle instead of clearing all peers — avoids jarring
    // empty list (M10 fix). Peers naturally repopulate as they're rediscovered.
    waveBleManager.restartScanCycle();
    // Brief pause so the user sees the refresh indicator
    await new Promise((r) => setTimeout(r, 800));
    setRefreshing(false);
  }, [isDiscoveryActive]);

  const sortedPeers = useMemo<NearbyPeer[]>(() => {
    const peers = Array.from(filteredPeers.values());
    const incomingSet = new Set(rawIncomingWaveTokens);

    // Sort: incoming wavers first, then by discovery time (stable order — no jumping)
    peers.sort((a, b) => {
      const aPriority = incomingSet.has(a.ephemeralToken) ? 1 : 0;
      const bPriority = incomingSet.has(b.ephemeralToken) ? 1 : 0;
      if (aPriority !== bPriority) return bPriority - aPriority;
      return a.discoveredAt - b.discoveredAt;
    });

    if (!showAllPeers && peers.length > PEER_DISPLAY_CAP) {
      return peers.slice(0, PEER_DISPLAY_CAP);
    }

    return peers;
  }, [filteredPeers, showAllPeers, rawIncomingWaveTokens]);

  const totalPeers = filteredPeers.size;

  const handleStartDiscovery = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setIsStarting(true);
    try {
      const result = await waveBleManager.requestPermissions();
      if (result === "blocked") {
        showPermissionBlockedAlert();
        return;
      }
      if (result !== "granted") {
        Alert.alert(
          t("radar.permissionsRequired"),
          t("radar.permissionsBody"),
        );
        return;
      }

      let token = useTokenStore.getState().currentToken;
      if (!token) {
        for (let i = 0; i < 16; i++) {
          await new Promise((r) => setTimeout(r, 500));
          token = useTokenStore.getState().currentToken;
          if (token) break;
        }
      }

      if (!token) {
        Alert.alert(
          t("radar.connectionIssue"),
          t("radar.connectionIssueBody"),
        );
        return;
      }

      await waveBleManager.start();
      impactLight();

      // Send location to server for proximity notifications (non-blocking)
      const nearbyAlertsEnabled = useAuthStore.getState().nearbyAlertsEnabled;
      if (nearbyAlertsEnabled) {
        getCurrentLocation().then((loc) => {
          if (loc) {
            updateLocationOnServer(loc.latitude, loc.longitude).catch((err) =>
              logger.error("Location update failed (non-fatal)", err),
            );
          }
        });
      }
    } catch (err) {
      logger.error("Failed to start discovery", err);
      Alert.alert(t("common.error"), t("radar.bluetoothError"));
    } finally {
      startingRef.current = false;
      setIsStarting(false);
    }
  }, []);

  // Auto-start discovery when opened from a proximity alert notification
  const [showProximityHint, setShowProximityHint] = useState(false);
  useEffect(() => {
    if (proximityAlertPending) {
      useBleStore.getState().setProximityAlertPending(false);
      setShowProximityHint(true);
      if (!isDiscoveryActive && !startingRef.current && permissionStatus === "granted") {
        handleStartDiscovery();
      }
    }
  }, [proximityAlertPending, isDiscoveryActive, permissionStatus, handleStartDiscovery]);

  // Clear the hint once peers appear
  useEffect(() => {
    if (showProximityHint && nearbyPeers.size > 0) {
      setShowProximityHint(false);
    }
  }, [showProximityHint, nearbyPeers]);

  const handleStopDiscovery = useCallback(async () => {
    await waveBleManager.stop();
  }, []);

  const handleWave = useCallback(async (peer: NearbyPeer) => {
    const store = useWaveStore.getState();
    if (store.hasPendingWaveTo(peer.ephemeralToken)) return;

    // Detect wave-back: the user is responding to someone who waved at them.
    // In this case we skip the optimistic "Undo" state — the intent is to
    // match, not to start a pending wave. Show a loading state instead.
    const isWaveBack = store.incomingWaveTokens.includes(peer.ephemeralToken);

    impactMedium();
    playWaveSent();

    if (isWaveBack) {
      store.addWavingBack(peer.ephemeralToken);
    } else {
      store.addPendingWave(peer.ephemeralToken);
    }

    logger.wave("Sending wave to peer", {
      token: peer.ephemeralToken.substring(0, 8),
      isWaveBack,
    });

    const result = await sendWave(peer.ephemeralToken);
    if (isWaveBack) store.removeWavingBack(peer.ephemeralToken);

    if (result.status === "expired_token") {
      // The peer's token rotated since we discovered them. If we know their
      // userId, find their fresh token in nearbyPeers and retry once (V4 fix).
      if (!isWaveBack) store.removePendingWave(peer.ephemeralToken);
      if (peer.userId) {
        const peers = useBleStore.getState().nearbyPeers;
        let freshToken: string | null = null;
        for (const [token, p] of peers) {
          if (p.userId === peer.userId && token !== peer.ephemeralToken) {
            freshToken = token;
            break;
          }
        }
        if (freshToken) {
          logger.wave("Retrying wave with fresh token after expired_token", {
            old: peer.ephemeralToken.substring(0, 8),
            fresh: freshToken.substring(0, 8),
          });
          if (!isWaveBack) store.addPendingWave(freshToken);
          const retry = await sendWave(freshToken);
          if (retry.status === "pending") {
            if (!isWaveBack) {
              if (retry.targetUserId) {
                useMatchStore.getState().setPendingWaveUser(retry.targetUserId, freshToken);
              }
            }
            setToast({ message: t("radar.waveSentToast") });
            return;
          } else if (retry.status === "match" && retry.match) {
            if (!isWaveBack) store.removePendingWave(freshToken);
            useMatchStore.getState().addMatch(retry.match);
            useMatchStore.getState().addMatchedToken(freshToken, {
              instagram: retry.match.instagramHandle,
              snapchat: retry.match.snapchatHandle,
            });
            notifySuccess();
            return;
          }
          if (!isWaveBack) store.removePendingWave(freshToken);
        }
      }
      notifyError();
      setToast({ message: t("radar.couldntWave"), variant: "error" });
    } else if (result.status === "error") {
      if (!isWaveBack) store.removePendingWave(peer.ephemeralToken);
      notifyError();
      setToast({ message: t("radar.couldntWave"), variant: "error" });
    } else if (result.status === "already_matched") {
      if (!isWaveBack) store.removePendingWave(peer.ephemeralToken);
      if (result.match) useMatchStore.getState().addMatch(result.match);
      useMatchStore.getState().addMatchedToken(peer.ephemeralToken, {
        instagram: result.match?.instagramHandle,
        snapchat: result.match?.snapchatHandle,
      });
      setToast({ message: t("radar.alreadyMatchedToast") });
    } else if (result.status === "rate_limited") {
      if (!isWaveBack) store.removePendingWave(peer.ephemeralToken);
      notifyError();
      setToast({ message: t("radar.waveTooFast"), variant: "error" });
    } else if (result.status === "blocked") {
      if (!isWaveBack) store.removePendingWave(peer.ephemeralToken);
      // Remove blocked peer from radar immediately and prevent flicker on BLE rediscovery
      useBleStore.getState().removePeer(peer.ephemeralToken);
      if (peer.userId) useBleStore.getState().addBlockedUserId(peer.userId);
      setToast({ message: t("radar.blockedWave"), variant: "error" });
    } else if (result.status === "match") {
      if (!isWaveBack) store.removePendingWave(peer.ephemeralToken);
      if (result.match) useMatchStore.getState().addMatch(result.match);
      useMatchStore.getState().addMatchedToken(peer.ephemeralToken, {
        instagram: result.match?.instagramHandle,
        snapchat: result.match?.snapchatHandle,
      });
      // Clean ALL wave state for the matched peer — this user completed the
      // match via HTTP response (not broadcast), so the cleanup in
      // realtime.ts doesn't fire here. Without this, removing the match
      // later would resurface "Wave back" or "Undo" from stale wave tokens.
      if (peer.userId) clearWaveStateForUser(peer.userId);
      notifySuccess();
      logger.wave("Match from wave!");
    } else if (result.status === "pending") {
      // Store userId → token mapping so realtime match events can bridge to radar
      if (result.targetUserId) {
        useMatchStore.getState().setPendingWaveUser(result.targetUserId, peer.ephemeralToken);
      }
      setToast({ message: t("radar.waveSentToast") });
    }
  }, []);

  const undoingRef = useRef<string | null>(null);
  const handleUndo = useCallback(async (targetToken: string) => {
    if (undoingRef.current === targetToken) return;
    undoingRef.current = targetToken;
    impactLight();
    const success = await undoWave(targetToken);
    undoingRef.current = null;
    if (success) {
      useWaveStore.getState().removePendingWave(targetToken);
      useMatchStore.getState().removePendingWaveByToken(targetToken);
      setToast({ message: t("radar.waveUndoneToast") });
    } else {
      notifyError();
      setToast({ message: t("radar.couldntUndo"), variant: "error" });
    }
  }, []);

  const handleInvite = useCallback(async () => {
    try {
      await Share.share({
        message: t("radar.shareMessage"),
      });
    } catch {
      // User cancelled share
    }
  }, []);

  const renderPeer = useCallback(
    ({ item }: { item: NearbyPeer }) => (
      <PeerRow peer={item} onWave={handleWave} onUndo={handleUndo} onPress={setSelectedPeer} isOffline={!isConnected} />
    ),
    [handleWave, handleUndo, isConnected],
  );


  // Show permission gate if not granted
  if (permissionStatus !== "granted" && !isDiscoveryActive) {
    return (
      <PermissionGate
        onRequestPermissions={handleStartDiscovery}
        isLoading={isStarting}
      />
    );
  }

  return (
    <View className="flex-1 bg-wave-bg pt-16 px-4">
      {/* Header */}
      <View className="flex-row items-center justify-between mb-4">
        <View>
          <Text className="text-3xl font-bold text-white">{t("radar.title")}</Text>
          <View className="flex-row items-center mt-1">
            {isDiscoveryActive && totalPeers > 0 && <LiveDot />}
            <Text className="text-wave-muted text-sm">
              {totalPeers > 0
                ? t("radar.peopleNearby", { count: totalPeers })
                : isDiscoveryActive
                  ? t("radar.searching")
                  : t("radar.startScanning")}
            </Text>
          </View>
        </View>
      </View>

      {/* DEV: Seed/clear fake data for UI testing */}
      {__DEV__ && (
        <View className="mb-2" style={{ gap: 6 }}>
          <View className="flex-row" style={{ gap: 8 }}>
            <TouchableOpacity
              onPress={() => { seedFakePeers(); useBleStore.getState().setDiscoveryActive(true); }}
              className="bg-yellow-600/30 rounded-lg px-3 py-1.5"
            >
              <Text className="text-yellow-400 text-xs font-semibold">Seed Peers</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={clearFakePeers}
              className="bg-red-600/30 rounded-lg px-3 py-1.5"
            >
              <Text className="text-red-400 text-xs font-semibold">Clear Peers</Text>
            </TouchableOpacity>
          </View>
          <View className="flex-row" style={{ gap: 8 }}>
            <TouchableOpacity
              onPress={seedFakeMatches}
              className="bg-pink-600/30 rounded-lg px-3 py-1.5"
            >
              <Text className="text-pink-400 text-xs font-semibold">Seed Matches</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={triggerFakeMatch}
              className="bg-green-600/30 rounded-lg px-3 py-1.5"
            >
              <Text className="text-green-400 text-xs font-semibold">Trigger Match</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={clearFakeMatches}
              className="bg-red-600/30 rounded-lg px-3 py-1.5"
            >
              <Text className="text-red-400 text-xs font-semibold">Clear Matches</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Status bar */}
      <BleStatusBar
        adapterState={adapterState}
        isScanning={isScanning}
        isAdvertising={isAdvertising}
        error={error}
      />

      {/* Offline banner */}
      {!isConnected && (
        <Animated.View
          entering={FadeIn.duration(300)}
          exiting={FadeOut.duration(200)}
          className="bg-yellow-500/20 border border-yellow-500/40 rounded-2xl py-3 px-4 mb-4 flex-row items-center"
        >
          <Text className="text-lg mr-3">📡</Text>
          <View className="flex-1">
            <Text className="text-yellow-400 font-semibold text-sm">
              {t("radar.noInternet")}
            </Text>
            <Text className="text-wave-muted text-xs mt-0.5">
              {t("radar.noInternetDescription")}
            </Text>
          </View>
        </Animated.View>
      )}

      {/* Incoming wave banner */}
      {incomingWaveTokens.length > 0 && (
        <Animated.View
          entering={FadeIn.duration(300)}
          exiting={FadeOut.duration(200)}
          className="bg-wave-wave/20 border border-wave-wave/40 rounded-2xl py-3 px-4 mb-4 flex-row items-center"
        >
          <Text className="text-2xl mr-3">👋</Text>
          <View className="flex-1">
            <Text className="text-white font-semibold text-sm">
              {incomingWaveTokens.length === 1
                ? t("radar.someoneWaved")
                : t("radar.peopleWaved", { count: incomingWaveTokens.length })}
            </Text>
            <Text className="text-wave-muted text-xs mt-0.5">
              {t("radar.waveBackHint")}
            </Text>
          </View>
        </Animated.View>
      )}

      {/* Quick note editor — context for nearby people */}
      {editingNote ? (
        <View className="bg-wave-surface rounded-2xl px-4 py-3 mb-3">
          <View className="flex-row items-center">
            <TextInput
              ref={noteInputRef}
              value={noteInput}
              onChangeText={setNoteInput}
              placeholder={t("radar.notePlaceholder")}
              placeholderTextColor={COLORS.placeholder}
              autoCapitalize="sentences"
              autoCorrect={false}
              maxLength={40}
              autoFocus
              className="flex-1 text-white text-sm"
              style={{ lineHeight: 18, paddingVertical: 0 }}
              returnKeyType="done"
              onSubmitEditing={handleSaveNote}
            />
            <Text className="text-wave-muted text-xs ml-2">{noteInput.length}/40</Text>
          </View>
          <View className="flex-row justify-end mt-2" style={{ gap: 8 }}>
            <TouchableOpacity
              onPress={() => { setEditingNote(false); setNoteInput(currentNote ?? ""); }}
              className="px-3 py-1.5"
            >
              <Text className="text-wave-muted text-xs font-semibold">{t("common.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSaveNote}
              disabled={savingNote}
              className="bg-wave-primary rounded-lg px-4 py-1.5"
            >
              {savingNote ? (
                <ActivityIndicator color={COLORS.white} size="small" />
              ) : (
                <Text className="text-white text-xs font-semibold">{t("common.save")}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          onPress={() => { setNoteInput(currentNote ?? ""); setEditingNote(true); }}
          className="bg-wave-surface/50 rounded-2xl px-4 py-3 mb-3 flex-row items-center"
          activeOpacity={0.7}
        >
          <Ionicons name="create-outline" size={16} color={COLORS.muted} style={{ marginRight: 8 }} />
          <Text className="text-wave-muted text-sm flex-1" numberOfLines={1}>
            {currentNote || t("radar.addNote")}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.muted} />
        </TouchableOpacity>
      )}

      {/* Start/Stop button */}
      {!isDiscoveryActive ? (
        <TouchableOpacity
          onPress={handleStartDiscovery}
          disabled={isStarting}
          className={`py-4 rounded-2xl items-center mb-4 ${isStarting ? "bg-wave-primary/70" : "bg-wave-primary"}`}
        >
          {isStarting ? (
            <View className="flex-row items-center">
              <ActivityIndicator size="small" color={COLORS.white} />
              <Text className="text-white text-lg font-semibold ml-2">
                {currentToken ? t("radar.starting") : t("radar.connecting")}
              </Text>
            </View>
          ) : (
            <Text className="text-white text-lg font-semibold">
              {t("radar.startDiscovery")}
            </Text>
          )}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={handleStopDiscovery}
          className="bg-wave-surface py-4 rounded-2xl items-center mb-4 border border-wave-muted"
        >
          <Text className="text-wave-muted text-lg font-semibold">
            {t("radar.stopDiscovery")}
          </Text>
        </TouchableOpacity>
      )}

      {/* Peer list */}
      <FlatList
        data={sortedPeers}
        keyExtractor={(item) => item.ephemeralToken}
        renderItem={renderPeer}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
            enabled={isDiscoveryActive}
          />
        }
        ListFooterComponent={
          !showAllPeers && totalPeers > PEER_DISPLAY_CAP ? (
            <TouchableOpacity
              onPress={() => setShowAllPeers(true)}
              className="bg-wave-surface rounded-2xl py-3 items-center mt-2 mb-4"
            >
              <Text className="text-wave-accent text-sm font-semibold">
                {t("radar.showMore", { count: totalPeers - PEER_DISPLAY_CAP })}
              </Text>
            </TouchableOpacity>
          ) : null
        }
        ListEmptyComponent={
          isDiscoveryActive ? (
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
                onPress={handleInvite}
                className="bg-wave-surface border border-wave-muted rounded-2xl py-3 px-6 flex-row items-center"
              >
                <Text className="text-lg mr-2">📲</Text>
                <Text className="text-white font-semibold text-sm">
                  {t("radar.inviteFriends")}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View className="items-center mt-16">
              {/* Static radar icon (no pulse) */}
              <View className="w-36 h-36 items-center justify-center">
                <View className="absolute w-36 h-36 rounded-full border-2 border-indigo-500/15" />
                <View className="absolute w-24 h-24 rounded-full border-2 border-indigo-500/20" />
                <View className="w-16 h-16 rounded-full bg-wave-primary/20 items-center justify-center border-2 border-wave-primary/40">
                  <Text className="text-3xl">📡</Text>
                </View>
              </View>

              <Text className="text-white text-lg font-bold mb-2 mt-6">
                {t("radar.discoverTitle")}
              </Text>
              <Text className="text-wave-muted text-sm text-center px-8 leading-5">
                {t("radar.discoverDescription").split("<bold>").map((part, i) => {
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
                onPress={handleInvite}
                className="bg-wave-surface border border-wave-muted rounded-2xl py-3 px-6 flex-row items-center mt-8"
              >
                <Text className="text-lg mr-2">📲</Text>
                <Text className="text-white font-semibold text-sm">
                  {t("radar.inviteFriends")}
                </Text>
              </TouchableOpacity>
            </View>
          )
        }
      />

      {/* Peer detail modal */}
      {selectedPeer && (
        <PeerDetailModal peer={selectedPeer} onClose={() => setSelectedPeer(null)} />
      )}

      <Toast message={toast?.message ?? null} variant={toast?.variant} onDismiss={() => setToast(null)} />
    </View>
  );
}

