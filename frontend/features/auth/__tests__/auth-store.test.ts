import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/features/auth/auth-store';

describe('auth store', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clearSession();
  });

  it('setSession keeps the access token in memory only and persists the refresh token', () => {
    useAuthStore.getState().setSession({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      consentStale: false,
    });

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('access-1');
    expect(state.status).toBe('authenticated');
    expect(state.consentStale).toBe(false);
    expect(localStorage.getItem('ucm-refresh')).toBe('refresh-1');
    // The access token must never touch storage.
    expect(localStorage.getItem('ucm-access')).toBeNull();
    expect(Object.keys(localStorage).some((k) => localStorage.getItem(k)?.includes('access-1'))).toBe(false);
  });

  it('round-trips consentStale', () => {
    useAuthStore.getState().setSession({
      accessToken: 'a',
      refreshToken: 'r',
      consentStale: true,
    });
    expect(useAuthStore.getState().consentStale).toBe(true);

    useAuthStore.getState().setConsentStale(false);
    expect(useAuthStore.getState().consentStale).toBe(false);
  });

  it('clearSession wipes memory and storage and goes anonymous', () => {
    useAuthStore.getState().setSession({
      accessToken: 'a',
      refreshToken: 'r',
      consentStale: false,
    });
    useAuthStore.getState().clearSession();

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.status).toBe('anonymous');
    expect(localStorage.getItem('ucm-refresh')).toBeNull();
  });

  it('getRefreshToken reads from storage', () => {
    expect(useAuthStore.getState().getRefreshToken()).toBeNull();
    useAuthStore.getState().setSession({
      accessToken: 'a',
      refreshToken: 'r-2',
      consentStale: false,
    });
    expect(useAuthStore.getState().getRefreshToken()).toBe('r-2');
  });
});
