import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Match, ContactHandles } from "@/types";
import { useBleStore } from "@/stores/bleStore";
import { logger } from "@/utils/logger";

interface MatchState {
  /** Match ID → Match object for O(1) lookups (O9 fix) */
  matchesById: Map<string, Match>;
  latestUnseenMatch: Match | null;

  /** Ephemeral tokens that returned already_matched this session */
  matchedTokens: Set<string>;
  /** Map ephemeral token → contact handles for matched peers (display in detail modal) */
  matchedHandles: Map<string, ContactHandles>;
  /** Map userId → ephemeralToken for pending waves (bridges realtime match events to radar) */
  pendingWaveUserMap: Map<string, string>;

  /** Tracked count of unseen matches — avoids full Map iteration on every render */
  unseenCount: number;

  // Derived accessor — returns matches as array (sorted newest first)
  getMatchesArray: () => Match[];

  addMatch: (match: Match) => void;
  removeMatch: (matchId: string) => void;
  updateMatchHandle: (matchId: string, instagramHandle: string) => void;
  updateMatchHandles: (matchId: string, handles: { instagramHandle?: string; snapchatHandle?: string }) => void;
  markMatchSeen: (matchId: string) => void;
  clearMatches: () => void;

  addMatchedToken: (token: string, handles?: ContactHandles) => void;
  clearMatchedTokens: () => void;
  setPendingWaveUser: (userId: string, ephemeralToken: string) => void;
  removePendingWaveByToken: (ephemeralToken: string) => void;

  reset: () => void;
}

// Memoization cache for getMatchesArray — avoids re-sorting on every render
let _cachedMapRef: Map<string, Match> | null = null;
let _cachedArray: Match[] = [];

/** Recompute unseen count from the matchesById Map */
function computeUnseenCount(map: Map<string, Match>): number {
  let count = 0;
  for (const m of map.values()) {
    if (!m.seen) count++;
  }
  return count;
}

export const useMatchStore = create<MatchState>()(
  persist(
    (set, get) => ({
      matchesById: new Map(),
      latestUnseenMatch: null,
      unseenCount: 0,

      matchedTokens: new Set<string>(),
      matchedHandles: new Map<string, ContactHandles>(),
      pendingWaveUserMap: new Map<string, string>(),

      getMatchesArray: () => {
        const map = get().matchesById;
        // Return cached array if Map reference hasn't changed
        if (map === _cachedMapRef) return _cachedArray;
        _cachedMapRef = map;
        _cachedArray = Array.from(map.values()).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        return _cachedArray;
      },

      addMatch: (match) =>
        set((state) => {
          const existing = state.matchesById.get(match.matchId);
          if (existing) {
            // Merge handles if the new call has data the existing doesn't (L1 fix).
            const needsIgUpdate = match.instagramHandle && !existing.instagramHandle;
            const needsScUpdate = match.snapchatHandle && !existing.snapchatHandle;
            if (needsIgUpdate || needsScUpdate) {
              const updated = {
                ...existing,
                ...(needsIgUpdate ? { instagramHandle: match.instagramHandle } : {}),
                ...(needsScUpdate ? { snapchatHandle: match.snapchatHandle } : {}),
              };
              const next = new Map(state.matchesById);
              next.set(match.matchId, updated);
              return {
                matchesById: next,
                latestUnseenMatch:
                  state.latestUnseenMatch?.matchId === match.matchId
                    ? { ...state.latestUnseenMatch, ...updated }
                    : state.latestUnseenMatch,
              };
            }
            return {};
          }

          // Bridge: if we have a pending wave to this user, mark their token as matched
          const ephemeralToken = state.pendingWaveUserMap.get(match.matchedUserId);
          let nextTokens = state.matchedTokens;
          let nextHandles = state.matchedHandles;
          let nextUserMap = state.pendingWaveUserMap;
          if (ephemeralToken) {
            nextTokens = new Set(state.matchedTokens);
            nextTokens.add(ephemeralToken);
            nextHandles = new Map(state.matchedHandles);
            const handles: ContactHandles = {};
            if (match.instagramHandle) handles.instagram = match.instagramHandle;
            if (match.snapchatHandle) handles.snapchat = match.snapchatHandle;
            if (handles.instagram || handles.snapchat) {
              const existingH = nextHandles.get(ephemeralToken);
              nextHandles.set(ephemeralToken, { ...existingH, ...handles });
            }
            nextUserMap = new Map(state.pendingWaveUserMap);
            nextUserMap.delete(match.matchedUserId);
          }

          const next = new Map(state.matchesById);
          next.set(match.matchId, match);

          return {
            matchesById: next,
            latestUnseenMatch: match.seen ? state.latestUnseenMatch : match,
            unseenCount: state.unseenCount + (match.seen ? 0 : 1),
            matchedTokens: nextTokens,
            matchedHandles: nextHandles,
            pendingWaveUserMap: nextUserMap,
          };
        }),

      removeMatch: (matchId) =>
        set((state) => {
          const removed = state.matchesById.get(matchId);
          const next = new Map(state.matchesById);
          next.delete(matchId);

          // Clean up matchedTokens so the peer reverts to "Wave" on radar
          let nextTokens = state.matchedTokens;
          let nextHandles = state.matchedHandles;
          if (removed) {
            const peers = useBleStore.getState().nearbyPeers;
            for (const [token, peer] of peers) {
              if (peer.userId === removed.matchedUserId && state.matchedTokens.has(token)) {
                nextTokens = new Set(state.matchedTokens);
                nextTokens.delete(token);
                nextHandles = new Map(state.matchedHandles);
                nextHandles.delete(token);
                break;
              }
            }
          }

          return {
            matchesById: next,
            matchedTokens: nextTokens,
            matchedHandles: nextHandles,
            latestUnseenMatch:
              state.latestUnseenMatch?.matchId === matchId
                ? null
                : state.latestUnseenMatch,
            unseenCount: removed && !removed.seen
              ? Math.max(0, state.unseenCount - 1)
              : state.unseenCount,
          };
        }),

      updateMatchHandle: (matchId, instagramHandle) =>
        set((state) => {
          const existing = state.matchesById.get(matchId);
          if (!existing) return {};
          const updated = { ...existing, instagramHandle };
          const next = new Map(state.matchesById);
          next.set(matchId, updated);
          return {
            matchesById: next,
            latestUnseenMatch:
              state.latestUnseenMatch?.matchId === matchId
                ? { ...state.latestUnseenMatch, instagramHandle }
                : state.latestUnseenMatch,
          };
        }),

      updateMatchHandles: (matchId, handles) =>
        set((state) => {
          const existing = state.matchesById.get(matchId);
          if (!existing) return {};
          const updates = {
            ...(handles.instagramHandle ? { instagramHandle: handles.instagramHandle } : {}),
            ...(handles.snapchatHandle ? { snapchatHandle: handles.snapchatHandle } : {}),
          };
          const updated = { ...existing, ...updates };
          const next = new Map(state.matchesById);
          next.set(matchId, updated);
          return {
            matchesById: next,
            latestUnseenMatch:
              state.latestUnseenMatch?.matchId === matchId
                ? { ...state.latestUnseenMatch, ...updates }
                : state.latestUnseenMatch,
          };
        }),

      markMatchSeen: (matchId) =>
        set((state) => {
          const existing = state.matchesById.get(matchId);
          if (!existing || existing.seen) return {};
          const next = new Map(state.matchesById);
          next.set(matchId, { ...existing, seen: true });
          return {
            matchesById: next,
            unseenCount: Math.max(0, state.unseenCount - 1),
            latestUnseenMatch:
              state.latestUnseenMatch?.matchId === matchId
                ? null
                : state.latestUnseenMatch,
          };
        }),

      clearMatches: () =>
        set({ matchesById: new Map(), latestUnseenMatch: null, unseenCount: 0 }),

      addMatchedToken: (token, handles) =>
        set((state) => {
          const nextTokens = new Set(state.matchedTokens);
          nextTokens.add(token);
          const nextHandles = new Map(state.matchedHandles);
          if (handles && (handles.instagram || handles.snapchat)) {
            const existing = nextHandles.get(token);
            nextHandles.set(token, { ...existing, ...handles });
          }
          return { matchedTokens: nextTokens, matchedHandles: nextHandles };
        }),

      clearMatchedTokens: () =>
        set({ matchedTokens: new Set(), matchedHandles: new Map<string, ContactHandles>() }),

      setPendingWaveUser: (userId, ephemeralToken) =>
        set((state) => {
          const next = new Map(state.pendingWaveUserMap);
          next.set(userId, ephemeralToken);
          return { pendingWaveUserMap: next };
        }),

      removePendingWaveByToken: (ephemeralToken) =>
        set((state) => {
          const next = new Map(state.pendingWaveUserMap);
          for (const [userId, token] of next) {
            if (token === ephemeralToken) {
              next.delete(userId);
              break;
            }
          }
          return { pendingWaveUserMap: next };
        }),

      reset: () => {
        _cachedMapRef = null;
        _cachedArray = [];
        set({
          matchesById: new Map(),
          latestUnseenMatch: null,
          unseenCount: 0,
          matchedTokens: new Set(),
          matchedHandles: new Map<string, ContactHandles>(),
          pendingWaveUserMap: new Map(),
        });
      },
    }),
    {
      name: "match-store",
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist matches — everything else is ephemeral session state.
      // Map must be serialized to array for JSON.stringify (Maps serialize to "{}").
      partialize: (state) => ({
        matchesById: Array.from(state.matchesById.values()),
      }),
      merge: (persisted: any, current) => {
        const base = { ...current };
        if (persisted && Array.isArray((persisted as any).matchesById)) {
          const map = new Map<string, Match>();
          for (const m of (persisted as any).matchesById as Match[]) {
            if (m && m.matchId) map.set(m.matchId, m);
          }
          base.matchesById = map;
          base.unseenCount = computeUnseenCount(map);
          logger.wave(`Hydrated ${map.size} matches from storage`);
        } else if (persisted) {
          // Persisted data exists but is in unexpected format — log for debugging
          logger.warn("matchStore hydration: unexpected persisted format", {
            type: typeof persisted,
            keys: persisted ? Object.keys(persisted) : [],
          });
        }
        return base;
      },
    },
  ),
);
