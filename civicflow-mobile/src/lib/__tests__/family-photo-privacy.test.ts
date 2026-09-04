/**
 * Build 26 privacy correction (D8), mobile half.
 *
 * The API stopped returning signed object-storage URLs for family photos, so
 * the client now fetches the bytes itself with its bearer token. These tests
 * exist to keep two specific mistakes from creeping back:
 *   1. the token being sent anywhere other than the Unestra API, and
 *   2. a storage URL reappearing in what the client renders.
 */
import { apiFetchImageDataUri, setAccessToken, API_BASE_URL } from '@/lib/api-client';
import { getPtaHouseholdPhoto } from '@/lib/mobile-api';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

function imageResponse(bytes: Uint8Array = JPEG, contentType = 'image/jpeg') {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': contentType }),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}

describe('family photo delivery — mobile client', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
    setAccessToken('test-access-token');
  });

  afterEach(() => setAccessToken(null));

  it('sends the bearer token ONLY to the Unestra API host', async () => {
    fetchMock.mockResolvedValueOnce(imageResponse());
    await apiFetchImageDataUri('/api/mobile/pta/household/photo?organizationId=org-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith(API_BASE_URL)).toBe(true);
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer test-access-token');
  });

  it('never contacts an object-storage host, and never sends the token to one', async () => {
    fetchMock.mockResolvedValueOnce(imageResponse());
    await apiFetchImageDataUri('/api/mobile/pta/household/photo?organizationId=org-1');

    for (const [url] of fetchMock.mock.calls as [string][]) {
      expect(url).not.toMatch(/digitaloceanspaces|amazonaws|X-Amz-Signature/i);
    }
  });

  it('returns a self-contained local data URI, not a remote URL', async () => {
    fetchMock.mockResolvedValueOnce(imageResponse());
    const uri = await apiFetchImageDataUri('/api/mobile/pta/household/photo?organizationId=org-1');

    expect(uri).toMatch(/^data:image\/jpeg;base64,/);
    expect(uri).not.toMatch(/^https?:/);
  });

  it('treats 404 as "no photo" rather than an error', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers() } as unknown as Response);
    await expect(apiFetchImageDataUri('/api/mobile/pta/household/photo?organizationId=org-1')).resolves.toBeNull();
  });

  it('getPtaHouseholdPhoto exposes a local uri and no storage reference at all', async () => {
    fetchMock.mockResolvedValueOnce(imageResponse());
    const photo = await getPtaHouseholdPhoto('org-1');

    expect(photo?.uri.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(JSON.stringify(photo)).not.toMatch(/https?:\/\//);
    // The old contract had a `url` field carrying a signed storage URL.
    expect((photo as unknown as Record<string, unknown>).url).toBeUndefined();
  });

  it('resolves to null for a household with no photo', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers() } as unknown as Response);
    await expect(getPtaHouseholdPhoto('org-1')).resolves.toBeNull();
  });

  it('scopes the request to the organization it was asked about', async () => {
    fetchMock.mockResolvedValueOnce(imageResponse());
    await getPtaHouseholdPhoto('org-XYZ');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('organizationId=org-XYZ');
    // No household, attachment or student id is ever sent: the server resolves
    // the household from the token, so there is nothing here to forge.
    expect(url).not.toMatch(/householdId|attachmentId|studentId/);
  });
});
