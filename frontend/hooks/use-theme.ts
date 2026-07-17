'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePreference = 'light' | 'dark' | 'system';

function systemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(preference: ThemePreference) {
  if (typeof document === 'undefined') return;
  const resolved = preference === 'system' ? systemTheme() : preference;
  document.documentElement.setAttribute('data-theme', resolved);
}

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      setPreference: (preference) => {
        applyTheme(preference);
        set({ preference });
      },
    }),
    {
      name: 'ucm-theme-preference',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.preference);
      },
    },
  ),
);

// The inline script in layout.tsx keys off 'ucm-theme' (a plain resolved
// value) for the pre-hydration paint; keep it in sync on every change.
useTheme.subscribe((state) => {
  try {
    const resolved = state.preference === 'system' ? systemTheme() : state.preference;
    localStorage.setItem('ucm-theme', resolved);
  } catch {
    /* storage unavailable (private mode) — theme still applies for the session */
  }
});

// React to OS-level changes while preference is 'system'.
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useTheme.getState().preference === 'system') applyTheme('system');
  });
}
