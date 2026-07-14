import { router } from 'expo-router';

/**
 * Allow-list of in-app destinations reachable via deep link (custom scheme
 * or universal link) or a push notification's `deepLink` payload. Anything
 * not matching one of these patterns is ignored rather than navigated to —
 * deep link destinations are never trusted blindly (spec security req #9).
 *
 * Keep this in sync with civicflow-portal/src/lib/deep-links.ts.
 */
const ALLOWED_DEEP_LINK_PATTERNS: RegExp[] = [
  /^\/report-payment$/,
  /^\/dues$/,
  /^\/announcements$/,
  /^\/events$/,
  /^\/payment-history$/,
  /^\/accept-invite(\?.*)?$/,
  /^\/organization\/[A-Za-z0-9_-]+$/,
  // Member engagement expansion — inbox, per-item detail screens, and the
  // Payments/Profile tabs. Keep in sync with civicflow-portal/src/lib/deep-links.ts.
  /^\/inbox$/,
  /^\/conversation\/[A-Za-z0-9_-]+$/,
  /^\/announcement\/[A-Za-z0-9_-]+$/,
  /^\/event\/[A-Za-z0-9_-]+$/,
  /^\/payments$/,
  /^\/profile$/,
  /^\/make-payment$/,
  /^\/make-payment\/dues$/,
  /^\/make-payment\/campaign\/[A-Za-z0-9_-]+$/,
  /^\/make-payment\/event\/[A-Za-z0-9_-]+$/,
  // QR meeting attendance — lets a push notification ("check-in is open")
  // deep-link straight to the scanner.
  /^\/attendance-scan$/,
  /^\/attendance-history$/,
];

/**
 * Hostnames https/http universal-link values are trusted from. Both the new
 * canonical domain (app.getunestra.com) and the legacy one (app.civicflowapp.com)
 * are accepted during the domain migration so links minted before the cutover
 * keep resolving. Keep in sync with civicflow-portal/src/lib/deep-links.ts.
 */
const ALLOWED_DEEP_LINK_HOSTS = new Set(['app.getunestra.com', 'app.civicflowapp.com']);

/**
 * Extracts the in-app path from a unestra:// or https://app.getunestra.com
 * (or legacy https://app.civicflowapp.com) URL, or a bare path already in that
 * form, and returns it only if it matches the allow-list — otherwise returns null.
 */
export function resolveAllowedDeepLinkPath(url: string): string | null {
  let path: string;
  try {
    if (url.startsWith('/')) {
      path = url;
    } else {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        if (!ALLOWED_DEEP_LINK_HOSTS.has(parsed.hostname)) return null;
        // Universal link — host is the domain, pathname is the in-app path.
        path = `/${parsed.pathname.replace(/^\/+/, '')}`;
      } else {
        // Custom scheme (unestra://report-payment or unestra://organization/abc) —
        // URL parsing puts the first path segment in `host`, the rest in `pathname`.
        path = `/${[parsed.host, parsed.pathname.replace(/^\/+/, '')].filter(Boolean).join('/')}`;
      }
      path += parsed.search;
    }
  } catch {
    return null;
  }

  return ALLOWED_DEEP_LINK_PATTERNS.some((pattern) => pattern.test(path)) ? path : null;
}

/** Navigates to a deep link only if it resolves to an allow-listed in-app path. */
export function navigateToDeepLink(url: string | null | undefined) {
  if (!url) return;
  const path = resolveAllowedDeepLinkPath(url);
  if (path) router.push(path as never);
}
