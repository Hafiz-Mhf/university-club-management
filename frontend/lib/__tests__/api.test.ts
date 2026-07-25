import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { api, apiUpload, apiDownloadBlob, ApiError, setOnAuthFailure, setOnConsentStale } from '@/lib/api';
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
    setOnConsentStale(null);
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

    const err = (await api('/organizations/nope').catch((e) => e)) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('Not found');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('consent-stale 403 flags the store and fires onConsentStale', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'tok',
      refreshToken: 'ref',
      consentStale: false,
    });
    const onStale = vi.fn();
    setOnConsentStale(onStale);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, { message: 'Account consent must be renewed' }),
    );

    const err = (await api('/organizations').catch((e) => e)) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(useAuthStore.getState().consentStale).toBe(true);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no refresh attempt on 403
  });

  it('an ordinary 403 does not flag consent', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'tok',
      refreshToken: 'ref',
      consentStale: false,
    });
    const onStale = vi.fn();
    setOnConsentStale(onStale);
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: 'Forbidden' }));

    await expect(api('/organizations/x/dashboard')).rejects.toBeInstanceOf(ApiError);

    expect(useAuthStore.getState().consentStale).toBe(false);
    expect(onStale).not.toHaveBeenCalled();
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

describe('apiUpload', () => {
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

  it('sends the FormData body as-is with no manually-set Content-Type header', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'tok',
      refreshToken: 'ref',
      consentStale: false,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: 'cert-1' }));
    const formData = new FormData();
    formData.set('userId', 'u1');

    await apiUpload('/organizations/o1/events/e1/certificates', formData);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://localhost:3001/organizations/o1/events/e1/certificates');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(formData);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('on 401: refreshes once, retries the original upload once', async () => {
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
      .mockResolvedValueOnce(jsonResponse(201, { id: 'cert-1' }));

    const result = await apiUpload<{ id: string }>('/path', new FormData());

    expect(result).toEqual({ id: 'cert-1' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryCall = fetchMock.mock.calls[2];
    expect((retryCall[1].headers as Record<string, string>).Authorization).toBe('Bearer fresh');
  });

  it('non-401 errors surface as ApiError', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'tok',
      refreshToken: 'ref',
      consentStale: false,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { message: 'A certificate already exists for this person and event' }));

    const err = (await apiUpload('/path', new FormData()).catch((e) => e)) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe('A certificate already exists for this person and event');
  });
});

describe('apiDownloadBlob', () => {
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

  it('returns the response body as a Blob on success', async () => {
    useAuthStore.getState().setSession({ accessToken: 'tok', refreshToken: 'ref', consentStale: false });
    fetchMock.mockResolvedValueOnce(
      new Response(new Blob(['%PDF-1.4 fake']), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      }),
    );

    const blob = await apiDownloadBlob('/organizations/o1/handover');

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://localhost:3001/organizations/o1/handover');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('on 401: refreshes once, retries the original request, and returns the Blob', async () => {
    useAuthStore.getState().setSession({ accessToken: 'stale', refreshToken: 'ref-1', consentStale: false });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(
        jsonResponse(201, { accessToken: 'fresh', refreshToken: 'ref-2', consentStale: false }),
      )
      .mockResolvedValueOnce(new Response(new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }), { status: 200 }));

    const blob = await apiDownloadBlob('/organizations/o1/handover');

    expect(blob).toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryCall = fetchMock.mock.calls[2];
    expect((retryCall[1].headers as Record<string, string>).Authorization).toBe('Bearer fresh');
  });

  it('a failure response parses the JSON error body and throws ApiError', async () => {
    useAuthStore.getState().setSession({ accessToken: 'tok', refreshToken: 'ref', consentStale: false });
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: 'Organization not found' }));

    const err = (await apiDownloadBlob('/organizations/nope/handover').catch((e) => e)) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('Organization not found');
  });
});
