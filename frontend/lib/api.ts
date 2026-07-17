'use client';

import { useAuthStore, type SessionTokens } from '@/features/auth/auth-store';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Attach the bearer token and run the 401→refresh→retry cycle. Default true. */
  auth?: boolean;
}

/** Called when a refresh attempt fails — the session is gone for good. */
let onAuthFailure: (() => void) | null = null;
export function setOnAuthFailure(handler: (() => void) | null) {
  onAuthFailure = handler;
}

/** Called when the backend blocks a request behind stale account consent. */
let onConsentStale: (() => void) | null = null;
export function setOnConsentStale(handler: (() => void) | null) {
  onConsentStale = handler;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageOf(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message: unknown }).message;
    if (typeof m === 'string') return m;
    if (Array.isArray(m)) return m.join(', ');
  }
  return fallback;
}

/**
 * Single-flight refresh: concurrent 401s all await the same in-flight
 * exchange instead of racing (the backend rotates refresh tokens, so a
 * second concurrent refresh with the same token would 401 and log the
 * user out spuriously).
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const store = useAuthStore.getState();
      const refreshToken = store.getRefreshToken();
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const tokens = (await parseBody(res)) as SessionTokens;
        useAuthStore.getState().setSession(tokens);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

const CONSENT_STALE_MESSAGE = 'Account consent must be renewed';

async function request(path: string, options: ApiOptions, retrying: boolean): Promise<Response> {
  const { method = 'GET', body, auth = true } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const accessToken = useAuthStore.getState().accessToken;
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && !retrying && path !== '/auth/refresh') {
    // Only try to recover a session that exists; an anonymous 401 is final.
    if (useAuthStore.getState().getRefreshToken()) {
      const refreshed = await refreshSession();
      if (refreshed) return request(path, options, true);
      useAuthStore.getState().clearSession();
      onAuthFailure?.();
    }
  }

  return res;
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const res = await request(path, options, false);
  const body = await parseBody(res);

  if (!res.ok) {
    const message = messageOf(body, res.statusText);
    if (res.status === 403 && message === CONSENT_STALE_MESSAGE) {
      useAuthStore.getState().setConsentStale(true);
      onConsentStale?.();
    }
    throw new ApiError(res.status, message);
  }

  return body as T;
}
