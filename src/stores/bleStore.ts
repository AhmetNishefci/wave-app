import { create } from "zustand";
import type { NearbyPeer, BlePermissionStatus, BleAdapterState } from "@/types";
import { PEER_STALE_TIMEOUT_MS } from "@/services/ble/constants";
import { useWaveStore } from "@/stores/waveStore";

const MAX_PEERS = 200;

interface BleState {
  adapterState: BleAdapterState;
  isScanning: boolean;
  isDiscoveryActive: boolean;
  isAdvertising: boolean;
  permissionStatus: BlePermissionStatus;
  nearbyPeers: Map<string, NearbyPeer>;
  blockedUserIds: Set<string>;
  error: string | null;
  /** Set when the user opens the app from a proximity alert notification */
  proximityAlertPending: boolean;
  /** Incremented on foreground to force useNoteResolver to re-query all peers */
  resolveGeneration: number;

  setAdapterState: (state: BleAdapterState) => void;
  setScanning: (scanning: boolean) => void;
  setDiscoveryActive: (active: boolean) => void;
  setAdvertising: (advertising: boolean) => void;
  setPermissionStatus: (status: BlePermissionStatus) => void;
  setError: (error: string | null) => void;
  setProximityAlertPending: (pending: boolean) => void;
  bumpResolveGeneration: () => void;
  upsertPeer: (peer: NearbyPeer) => void;
  removePeer: (token: string) => void;
  pruneStale: () => void;
  removeByUserId: (userId: string) => void;
  addBlockedUserId: (userId: string) => void;
  removeBlockedUserId: (userId: string) => void;
  clearPeers: () => void;
  reset: () => void;
}

export const useBleStore = create<BleState>((set, get) => ({
  adapterState: "Unknown",
  isScanning: false,
  isDiscoveryActive: false,
  isAdvertising: false,
  permissionStatus: "unknown",
  nearbyPeers: new Map(),
  blockedUserIds: new Set(),
  error: null,
  proximityAlertPending: false,
  resolveGeneration: 0,

  setAdapterState: (adapterState) => set({ adapterState }),
  setScanning: (isScanning) => set({ isScanning }),
  setDiscoveryActive: (isDiscoveryActive) => set({ isDiscoveryActive }),
  setAdvertising: (isAdvertising) => set({ isAdvertising }),
  setPermissionStatus: (permissionStatus) => set({ permissionStatus }),
  setError: (error) => set({ error }),
  setProximityAlertPending: (proximityAlertPending) => set({ proximityAlertPending }),
  bumpResolveGeneration: () => set((state) => ({ resolveGeneration: state.resolveGeneration + 1 })),

  upsertPeer: (peer) =>
    set((state) => {
      const next = new Map(state.nearbyPeers);
      next.set(peer.ephemeralToken, peer);

      // Evict weakest-signal peer if over cap
      if (next.size > MAX_PEERS) {
        let weakestToken: string | null = null;
        let weakestRssi = Infinity;
        for (const [token, p] of next) {
          if (token !== peer.ephemeralToken && p.rssi < weakestRssi) {
            weakestRssi = p.rssi;
            weakestToken = token;
          }
        }
        if (weakestToken) next.delete(weakestToken);
      }

      return { nearbyPeers: next };
    }),

  removePeer: (token) =>
    set((state) => {
      const next = new Map(state.nearbyPeers);
      next.delete(token);
      return { nearbyPeers: next };
    }),

  pruneStale: () =>
    set((state) => {
      const now = Date.now();
      // Don't prune peers involved in active interactions (M2 fix)
      const waveState = useWaveStore.getState();
      const protectedTokens = new Set<string>();
      for (const token of waveState.pendingWaves.keys()) {
        protectedTokens.add(token);
      }
      for (const token of waveState.incomingWaveTokens) {
        protectedTokens.add(token);
      }

      // Check if any peers are stale before cloning the Map (L9 fix)
      let hasStale = false;
      for (const [token, peer] of state.nearbyPeers) {
        if (now - peer.lastSeen > PEER_STALE_TIMEOUT_MS && !protectedTokens.has(token)) {
          hasStale = true;
          break;
        }
      }
      if (!hasStale) return {};
      const next = new Map(state.nearbyPeers);
      for (const [token, peer] of next) {
        if (now - peer.lastSeen > PEER_STALE_TIMEOUT_MS && !protectedTokens.has(token)) {
          next.delete(token);
        }
      }
      return { nearbyPeers: next };
    }),

  removeByUserId: (userId) =>
    set((state) => {
      if (!userId) return state; // Guard against null/undefined
      let found = false;
      const next = new Map(state.nearbyPeers);
      for (const [token, peer] of next) {
        if (peer.userId === userId) {
          next.delete(token);
          found = true;
        }
      }
      return found ? { nearbyPeers: next } : state;
    }),

  addBlockedUserId: (userId) =>
    set((state) => {
      if (!userId) return state;
      if (state.blockedUserIds.has(userId)) return state;
      const next = new Set(state.blockedUserIds);
      next.add(userId);
      return { blockedUserIds: next };
    }),

  removeBlockedUserId: (userId) =>
    set((state) => {
      if (!userId || !state.blockedUserIds.has(userId)) return state;
      const next = new Set(state.blockedUserIds);
      next.delete(userId);
      return { blockedUserIds: next };
    }),

  clearPeers: () => set({ nearbyPeers: new Map() }),

  reset: () =>
    set({
      adapterState: "Unknown",
      isScanning: false,
      isDiscoveryActive: false,
      isAdvertising: false,
      permissionStatus: "unknown",
      nearbyPeers: new Map(),
      blockedUserIds: new Set(),
      error: null,
      proximityAlertPending: false,
      resolveGeneration: 0,
    }),
}));
