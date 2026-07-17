'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/features/auth/auth-store';
import type { AuthTokens, ConsentRecordItem, RegisteredUser } from '@/types/api';
import type { LoginInput, RegisterInput } from '@/features/auth/schemas';

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (input: LoginInput) =>
      api<AuthTokens>('/auth/login', { method: 'POST', body: input, auth: false }),
    onSuccess: (tokens) => setSession(tokens),
  });
}

export function useRegister() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: async (input: RegisterInput) => {
      await api<RegisteredUser>('/auth/register', { method: 'POST', body: input, auth: false });
      // Backend register returns no tokens — log straight in.
      return api<AuthTokens>('/auth/login', {
        method: 'POST',
        body: { email: input.email, password: input.password },
        auth: false,
      });
    },
    onSuccess: (tokens) => setSession(tokens),
  });
}

export function useLogout() {
  const store = useAuthStore;
  return useMutation({
    mutationFn: async () => {
      const refreshToken = store.getState().getRefreshToken();
      if (refreshToken) {
        // Best-effort revoke; local sign-out proceeds regardless.
        await api('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => undefined);
      }
    },
    onSettled: () => store.getState().clearSession(),
  });
}

export function useRenewConsent() {
  const setConsentStale = useAuthStore((s) => s.setConsentStale);
  return useMutation({
    mutationFn: () => api<ConsentRecordItem>('/me/consent', { method: 'POST' }),
    onSuccess: () => setConsentStale(false),
  });
}
