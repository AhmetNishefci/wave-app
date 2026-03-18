import { create } from "zustand";

interface TokenState {
  currentToken: string | null;
  tokenExpiresAt: number | null;
  isRotating: boolean;

  setToken: (token: string, expiresAt: number) => void;
  setRotating: (rotating: boolean) => void;
  clearToken: () => void;
  reset: () => void;
}

export const useTokenStore = create<TokenState>((set) => ({
  currentToken: null,
  tokenExpiresAt: null,
  isRotating: false,

  setToken: (token, expiresAt) =>
    set({ currentToken: token, tokenExpiresAt: expiresAt }),

  setRotating: (isRotating) => set({ isRotating }),

  clearToken: () => set({ currentToken: null, tokenExpiresAt: null }),

  reset: () =>
    set({
      currentToken: null,
      tokenExpiresAt: null,
      isRotating: false,
    }),
}));
