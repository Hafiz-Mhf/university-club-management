'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/features/auth/auth-store';
import type { AuthTokens } from '@/types/api';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * On first mount, exchange a persisted refresh token for a fresh session.
 * Runs the raw fetch (not lib/api) on purpose: this is the one call that
 * must not recurse into the 401→refresh cycle.
 */
export function useSessionRestore() {
  const status = useAuthStore((s) => s.status);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const store = useAuthStore.getState();
    const refreshToken = store.getRefreshToken();
    if (!refreshToken) {
      store.setStatus('anonymous');
      return;
    }

    (async () => {
      try {
        const res = await fetch(`${BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) {
          store.clearSession();
          return;
        }
        const tokens = (await res.json()) as AuthTokens;
        store.setSession(tokens);
      } catch {
        // Backend unreachable — treat as signed out rather than hanging.
        store.clearSession();
      }
    })();
  }, []);

  return status;
}
