import { create } from "zustand";

interface TokenState {
  currentToken: string | null;
  tokenExpiresAt: number | null;
  isRotating: boolean;
  /** True when token rotation has failed repeatedly and the token may be expired */
  tokenStale: boolean;

  setToken: (token: string, expiresAt: number) => void;
  setRotating: (rotating: boolean) => void;
  setTokenStale: (stale: boolean) => void;
  clearToken: () => void;
  reset: () => void;
}

export const useTokenStore = create<TokenState>((set) => ({
  currentToken: null,
  tokenExpiresAt: null,
  isRotating: false,
  tokenStale: false,

  setToken: (token, expiresAt) =>
    set({ currentToken: token, tokenExpiresAt: expiresAt, tokenStale: false }),

  setRotating: (isRotating) => set({ isRotating }),

  setTokenStale: (tokenStale) => set({ tokenStale }),

  clearToken: () => set({ currentToken: null, tokenExpiresAt: null }),

  reset: () =>
    set({
      currentToken: null,
      tokenExpiresAt: null,
      isRotating: false,
      tokenStale: false,
    }),
}));
