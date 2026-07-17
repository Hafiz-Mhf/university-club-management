'use client';

import { create } from 'zustand';

const REFRESH_KEY = 'ucm-refresh';

export type AuthStatus = 'restoring' | 'authenticated' | 'anonymous';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  consentStale: boolean;
}

interface AuthState {
  /** Access token lives in memory only — never written to storage. */
  accessToken: string | null;
  consentStale: boolean;
  status: AuthStatus;
  setSession: (tokens: SessionTokens) => void;
  clearSession: () => void;
  setConsentStale: (stale: boolean) => void;
  setStatus: (status: AuthStatus) => void;
  getRefreshToken: () => string | null;
}

function readRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  consentStale: false,
  status: 'restoring',

  setSession: ({ accessToken, refreshToken, consentStale }) => {
    try {
      localStorage.setItem(REFRESH_KEY, refreshToken);
    } catch {
      /* storage unavailable — session survives in memory for this tab */
    }
    set({ accessToken, consentStale, status: 'authenticated' });
  },

  clearSession: () => {
    try {
      localStorage.removeItem(REFRESH_KEY);
    } catch {
      /* ignore */
    }
    set({ accessToken: null, consentStale: false, status: 'anonymous' });
  },

  setConsentStale: (consentStale) => set({ consentStale }),
  setStatus: (status) => set({ status }),
  getRefreshToken: readRefreshToken,
}));
