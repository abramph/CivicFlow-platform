import { secureStorage } from '@/lib/secure-storage';

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type TokenState = {
  accessToken: string | null;
};

// Access tokens are short-lived (15 min) and only ever kept in memory —
// the refresh token (long-lived) is the only thing persisted to SecureStore.
const tokenState: TokenState = { accessToken: null };

let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  tokenState.accessToken = token;
}

export function registerSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

/**
 * Wraps a bare fetch() for the call sites that need the same "dropped
 * connection becomes a normal ApiError" protection apiFetch has, but can't
 * use apiFetch itself (no auth header / 401-retry semantics wanted here) --
 * the auth rawPost() helper and refreshAccessToken() below. No timeout: both
 * callers are one-shot auth requests already guarded by their own retry/
 * fallback logic rather than a screen's load() waiting indefinitely.
 */
export async function fetchOrThrow(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new ApiError('Network request failed. Check your connection and try again.', 0);
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await secureStorage.getRefreshToken();
  if (!refreshToken) return null;

  // A network failure here throws (via fetchOrThrow) rather than returning
  // null, so it propagates out of apiFetch's 401 handler below instead of
  // being treated as "refresh rejected" -- an unreachable server shouldn't
  // force a sign-out the way an actually-invalid refresh token should.
  const response = await fetchOrThrow(`${API_BASE_URL}/api/mobile/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) return null;

  tokenState.accessToken = payload.data.accessToken as string;
  await secureStorage.setRefreshToken(payload.data.refreshToken as string);
  return tokenState.accessToken;
}

interface ApiFetchOptions extends RequestInit {
  /** Set false to skip attaching the bearer token (e.g. login/refresh calls). */
  authenticated?: boolean;
  /** Internal: prevents infinite refresh loops. */
  _isRetry?: boolean;
}

/** No caller currently passes its own `signal` (verified: nothing in this codebase uses AbortController), so it's safe for apiFetch to own the controller outright rather than composing with a caller-supplied one. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Fetches an image from the Unestra API as a self-contained `data:` URI.
 *
 * Family photos are household and children's data, so the API no longer hands
 * out signed object-storage URLs for them — the bytes come from an endpoint
 * that authorizes the bearer token first. That means <Image source={{uri}} />
 * can't fetch the image itself: React Native's Image has no reliable, uniform
 * way to attach an Authorization header across both platforms, and pushing the
 * token into an <Image> request risks leaking it toward whatever host the URI
 * happens to name. So the authenticated fetch happens here, in code that can
 * only ever talk to API_BASE_URL, and the screen renders the returned local
 * URI.
 *
 * A `data:` URI rather than a `blob:` one: React Native has no dependable
 * blob-URL object store across platforms, whereas `data:` renders natively and
 * needs no lifecycle management or revocation.
 *
 * Returns null for 404 ("no photo"), which is a normal state and not an error.
 * Mirrors apiFetch's timeout and single 401-refresh-retry behaviour.
 */
export async function apiFetchImageDataUri(path: string, _isRetry = false): Promise<string | null> {
  const headers = new Headers();
  if (tokenState.accessToken) headers.set('Authorization', `Bearer ${tokenState.accessToken}`);
  headers.set('Accept', 'image/*');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    // Always API_BASE_URL: the token is only ever sent to the Unestra API, and
    // never to an object-storage host.
    response = await fetch(`${API_BASE_URL}${path}`, { headers, signal: controller.signal });
  } catch (error) {
    throw new ApiError(
      error instanceof Error && error.name === 'AbortError'
        ? 'Request timed out. Check your connection and try again.'
        : 'Network request failed. Check your connection and try again.',
      0
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 401 && !_isRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return apiFetchImageDataUri(path, true);
    onSessionExpired?.();
    throw new ApiError('Session expired', 401);
  }

  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError('Request failed', response.status);

  // Trust the server's own normalized type, not anything the uploader
  // declared; fall back to JPEG because that is what the pipeline re-encodes
  // every stored family photo to.
  const contentType = response.headers.get('content-type') ?? 'image/jpeg';
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  // btoa is available in the React Native runtime.
  return `data:${contentType};base64,${btoa(binary)}`;
}

export async function apiFetch<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { authenticated = true, _isRetry, headers, ...rest } = options;

  const finalHeaders = new Headers(headers);
  if (rest.body && !(rest.body instanceof FormData)) {
    finalHeaders.set('Content-Type', 'application/json');
  }
  if (authenticated && tokenState.accessToken) {
    finalHeaders.set('Authorization', `Bearer ${tokenState.accessToken}`);
  }

  // Previously a bare fetch() with no timeout and no try/catch around
  // network-level failures -- a dropped connection or a server that never
  // responds hung forever rather than surfacing an error, and every caller
  // (every screen's load()) had nothing to catch anyway. Both halves of that
  // are fixed here: a timeout so a hang becomes a real error, and a
  // try/catch so network-level failures (not just HTTP error responses)
  // become a normal ApiError callers can catch.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...rest, headers: finalHeaders, signal: controller.signal });
  } catch (error) {
    throw new ApiError(
      error instanceof Error && error.name === 'AbortError'
        ? 'Request timed out. Check your connection and try again.'
        : 'Network request failed. Check your connection and try again.',
      0
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 401 && authenticated && !_isRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiFetch<T>(path, { ...options, _isRetry: true });
    }
    onSessionExpired?.();
    throw new ApiError('Session expired', 401);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new ApiError(payload?.error ?? 'Request failed', response.status, payload?.error);
  }

  return payload.data as T;
}
