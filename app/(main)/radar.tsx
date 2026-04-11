import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
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
import { useBleStore } from "@/stores/bleStore";
import { useTokenStore } from "@/stores/tokenStore";
import { waveBleManager } from "@/services/ble/bleManager";
import { PermissionGate } from "@/components/PermissionGate";
import { BleStatusBar } from "@/components/StatusBar";
import { Toast } from "@/components/Toast";
import { PeerRow } from "@/components/PeerRow";
import { PeerDetailModal } from "@/components/PeerDetailModal";
import { NoteEditor } from "@/components/NoteEditor";
import { RadarEmptyState } from "@/components/RadarEmptyState";
import type { NearbyPeer } from "@/types";
import { useNoteResolver } from "@/hooks/useNoteResolver";
import { useFilteredPeers } from "@/hooks/useFilteredPeers";
import { useWaveActions } from "@/hooks/useWaveActions";
import { useRadarDiscovery } from "@/hooks/useRadarDiscovery";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { seedFakePeers, clearFakePeers, seedFakeMatches, triggerFakeMatch, clearFakeMatches } from "@/utils/seedPeers";
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
  const { adapterState, isScanning, isAdvertising, error } = useBleStore();
  const { currentToken } = useTokenStore();
  const { isConnected } = useNetworkStatus();

  const [showAllPeers, setShowAllPeers] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant?: "success" | "error" } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPeer, setSelectedPeer] = useState<NearbyPeer | null>(null);

  // Extracted hooks
  const { sortedPeers, incomingWaveTokens, totalPeers } = useFilteredPeers(showAllPeers);
  const { handleWave, handleUndo } = useWaveActions(setToast);
  const { isStarting, showProximityHint, showGate, isDiscoveryActive, handleStartDiscovery, handleStopDiscovery } = useRadarDiscovery();

  // Resolve peer notes from server
  useNoteResolver(isDiscoveryActive);

  // DEV ONLY: Triple-tap radar title to seed fake data for screenshots
  const devTapCount = useRef(0);
  const devTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleDevTap = useCallback(() => {
    if (!__DEV__) return;
    devTapCount.current++;
    if (devTapTimer.current) clearTimeout(devTapTimer.current);
    if (devTapCount.current === 3) {
      devTapCount.current = 0;
      Alert.alert("Dev Tools", "Seed data for screenshots", [
        { text: "Seed Peers", onPress: () => seedFakePeers() },
        { text: "Seed Matches", onPress: () => seedFakeMatches() },
        { text: "Trigger Match", onPress: () => triggerFakeMatch() },
        { text: "Clear All", onPress: () => { clearFakePeers(); clearFakeMatches(); } },
        { text: "Cancel", style: "cancel" },
      ]);
    } else {
      devTapTimer.current = setTimeout(() => { devTapCount.current = 0; }, 500);
    }
  }, []);

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

  const handleInvite = useCallback(async () => {
    try {
      await Share.share({
        message: t("radar.shareMessage"),
      });
    } catch {
      // User cancelled share
    }
  }, [t]);

  const renderPeer = useCallback(
    ({ item }: { item: NearbyPeer }) => (
      <PeerRow peer={item} onWave={handleWave} onUndo={handleUndo} onPress={setSelectedPeer} isOffline={!isConnected} />
    ),
    [handleWave, handleUndo, isConnected],
  );

  // Show permission gate only if the user genuinely hasn't granted permissions.
  if (showGate) {
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
          <Text className="text-3xl font-bold text-white" onPress={handleDevTap}>{t("radar.title")}</Text>
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
      <NoteEditor setToast={setToast} />

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
          <RadarEmptyState
            isDiscoveryActive={isDiscoveryActive}
            showProximityHint={showProximityHint}
            onInvite={handleInvite}
          />
        }
      />

      {/* Peer detail modal */}
      {selectedPeer && (
        <PeerDetailModal peer={selectedPeer} onClose={() => setSelectedPeer(null)} setToast={setToast} />
      )}

      <Toast message={toast?.message ?? null} variant={toast?.variant} onDismiss={() => setToast(null)} />
    </View>
  );
}
