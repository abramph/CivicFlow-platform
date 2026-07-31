import { apiFetch, ApiError } from '@/lib/api-client';

jest.mock('@/lib/secure-storage', () => ({
  secureStorage: { getRefreshToken: jest.fn(), setRefreshToken: jest.fn() },
}));

describe('apiFetch network-failure handling', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('throws a clear ApiError when the network request fails outright, not just an unhandled rejection', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    await expect(apiFetch('/api/mobile/dues', { authenticated: false })).rejects.toBeInstanceOf(ApiError);
  });

  it('reports status 0 for a network-level failure, distinct from an HTTP error status', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    await expect(apiFetch('/api/mobile/dues', { authenticated: false })).rejects.toMatchObject({ status: 0 });
  });

  it('aborts and throws a timeout-specific error when the server never responds', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const promise = apiFetch('/api/mobile/dues', { authenticated: false });
    const assertion = expect(promise).rejects.toMatchObject({ message: expect.stringContaining('timed out') });
    await jest.advanceTimersByTimeAsync(20_000);
    await assertion;
  });

  it('still throws ApiError with the server-provided message for a normal non-ok HTTP response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 404,
      ok: false,
      json: async () => ({ ok: false, error: 'Not found' }),
    });

    await expect(apiFetch('/api/mobile/dues', { authenticated: false })).rejects.toMatchObject({
      status: 404,
      message: 'Not found',
    });
  });

  it('still resolves with the response data on a successful request', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ ok: true, data: { outstandingBalance: 60 } }),
    });

    await expect(apiFetch('/api/mobile/dues', { authenticated: false })).resolves.toEqual({ outstandingBalance: 60 });
  });
});
