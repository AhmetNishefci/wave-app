/**
 * Wave-only store — pending waves and incoming wave tokens.
 * Token state lives in tokenStore, match state in matchStore.
 */
import { create } from "zustand";
import type { WavePending } from "@/types";

// O4 fix: Cap incoming wave tokens to prevent unbounded growth in crowded venues
const MAX_INCOMING_WAVE_TOKENS = 100;

interface WaveState {
  pendingWaves: Map<string, WavePending>;

  /** Tokens currently in-flight for wave-back (loading spinner, per-peer) */
  wavingBackTokens: Set<string>;

  /** Ephemeral tokens of people who waved at us (anonymous, for "Wave Back" UI) */
  incomingWaveTokens: string[];

  addPendingWave: (targetToken: string) => void;
  removePendingWave: (targetToken: string) => void;
  clearAllPendingWaves: () => void;
  hasPendingWaveTo: (targetToken: string) => boolean;
  addWavingBack: (token: string) => void;
  removeWavingBack: (token: string) => void;

  addIncomingWaveToken: (token: string) => void;
  removeIncomingWaveToken: (token: string) => void;
  resetIncomingWaveTokens: () => void;

  reset: () => void;
}

export const useWaveStore = create<WaveState>((set, get) => ({
  pendingWaves: new Map(),
  wavingBackTokens: new Set(),

  incomingWaveTokens: [],

  addPendingWave: (targetToken) =>
    set((state) => {
      const next = new Map(state.pendingWaves);
      next.set(targetToken, { targetToken, sentAt: Date.now() });
      return { pendingWaves: next };
    }),

  removePendingWave: (targetToken) =>
    set((state) => {
      const next = new Map(state.pendingWaves);
      next.delete(targetToken);
      return { pendingWaves: next };
    }),

  clearAllPendingWaves: () => set({ pendingWaves: new Map() }),

  hasPendingWaveTo: (targetToken) => get().pendingWaves.has(targetToken),

  addWavingBack: (token) =>
    set((state) => {
      const next = new Set(state.wavingBackTokens);
      next.add(token);
      return { wavingBackTokens: next };
    }),

  removeWavingBack: (token) =>
    set((state) => {
      const next = new Set(state.wavingBackTokens);
      next.delete(token);
      return { wavingBackTokens: next };
    }),

  addIncomingWaveToken: (token) =>
    set((state) => {
      if (state.incomingWaveTokens.includes(token)) return state;
      const next = [...state.incomingWaveTokens, token];
      // O4 fix: evict oldest tokens when cap is exceeded
      if (next.length > MAX_INCOMING_WAVE_TOKENS) {
        return { incomingWaveTokens: next.slice(-MAX_INCOMING_WAVE_TOKENS) };
      }
      return { incomingWaveTokens: next };
    }),

  removeIncomingWaveToken: (token) =>
    set((state) => ({
      incomingWaveTokens: state.incomingWaveTokens.filter((t) => t !== token),
    })),

  resetIncomingWaveTokens: () => set({ incomingWaveTokens: [] }),

  reset: () =>
    set({
      pendingWaves: new Map(),
      wavingBackTokens: new Set(),
      incomingWaveTokens: [],
    }),
}));
