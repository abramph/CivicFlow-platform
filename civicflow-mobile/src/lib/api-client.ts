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

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await secureStorage.getRefreshToken();
  if (!refreshToken) return null;

  const response = await fetch(`${API_BASE_URL}/api/mobile/auth/refresh`, {
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
