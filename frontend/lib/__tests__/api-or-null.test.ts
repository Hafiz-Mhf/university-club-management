import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiOrNull } from '@/lib/api';

/**
 * The event page hammered the API at ~100 req/s because "I have no certificate
 * for this event" arrived as a thrown 404: an errored query is permanently
 * stale, so it refetched on every remount and the panel never left its
 * loading state. These tests pin the contract that fixed it.
 */
function mockFetch(status: number, body: unknown = {}) {
  const spy = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiOrNull', () => {
  it('reads a 404 as "nothing here" rather than a failure', async () => {
    mockFetch(404, { message: 'Certificate not found' });
    await expect(apiOrNull('/organizations/o/events/e/certificates/me')).resolves.toBeNull();
  });

  it('returns the body on success', async () => {
    mockFetch(200, { id: 'cert-1' });
    await expect(apiOrNull('/organizations/o/events/e/certificates/me')).resolves.toEqual({ id: 'cert-1' });
  });

  it('still throws on a real failure, so 403 is never mistaken for "nothing here"', async () => {
    mockFetch(403, { message: 'Forbidden' });
    await expect(apiOrNull('/organizations/o/events/e/certificates/me')).rejects.toBeInstanceOf(ApiError);
  });

  it('still throws on a server error', async () => {
    mockFetch(500, { message: 'Internal server error' });
    await expect(apiOrNull('/organizations/o/events/e/certificates/me')).rejects.toBeInstanceOf(ApiError);
  });
});
