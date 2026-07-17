import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { api, ApiError, setOnAuthFailure } from '@/lib/api';
import { useAuthStore } from '@/features/auth/auth-store';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clearSession();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setOnAuthFailure(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches the bearer token from the store', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'tok',
      refreshToken: 'ref',
      consentStale: false,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await api('/organizations');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://localhost:3001/organizations');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('on 401: refreshes once, retries the original request once', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'stale',
      refreshToken: 'ref-1',
      consentStale: false,
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(
        jsonResponse(201, { accessToken: 'fresh', refreshToken: 'ref-2', consentStale: false }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { data: 42 }));

    const result = await api<{ data: number }>('/organizations');

    expect(result).toEqual({ data: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const refreshCall = fetchMock.mock.calls[1];
    expect(String(refreshCall[0])).toBe('http://localhost:3001/auth/refresh');
    expect(JSON.parse(refreshCall[1].body)).toEqual({ refreshToken: 'ref-1' });
    // Retry carries the fresh token.
    const retryCall = fetchMock.mock.calls[2];
    expect((retryCall[1].headers as Record<string, string>).Authorization).toBe('Bearer fresh');
    // Store rotated.
    expect(useAuthStore.getState().accessToken).toBe('fresh');
    expect(localStorage.getItem('ucm-refresh')).toBe('ref-2');
  });

  it('two concurrent 401s share a single refresh call', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'stale',
      refreshToken: 'ref-1',
      consentStale: false,
    });

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/auth/refresh')) {
        return Promise.resolve(
          jsonResponse(201, { accessToken: 'fresh', refreshToken: 'ref-2', consentStale: false }),
        );
      }
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      if (auth === 'Bearer stale') {
        return Promise.resolve(jsonResponse(401, { message: 'Unauthorized' }));
      }
      return Promise.resolve(jsonResponse(200, { ok: true }));
    });

    await Promise.all([api('/a'), api('/b')]);

    const refreshCalls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('failed refresh clears the session and fires onAuthFailure', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'stale',
      refreshToken: 'dead',
      consentStale: false,
    });
    const onFailure = vi.fn();
    setOnAuthFailure(onFailure);

    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Invalid refresh token' }));

    await expect(api('/organizations')).rejects.toBeInstanceOf(ApiError);

    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(localStorage.getItem('ucm-refresh')).toBeNull();
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('non-401 errors surface as ApiError without any refresh attempt', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'tok',
      refreshToken: 'ref',
      consentStale: false,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: 'Not found' }));

    const err = await api('/organizations/nope').catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('Not found');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('anonymous requests send no Authorization header and never refresh on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }));

    await expect(api('/auth/login', { method: 'POST', body: { email: 'a', password: 'b' } }))
      .rejects.toBeInstanceOf(ApiError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
