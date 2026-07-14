/**
 * Legacy-domain → canonical-domain redirect logic (domain migration, Phase 10).
 *
 * Kept as a pure function so it can be unit-tested without constructing a full
 * NextRequest. The middleware supplies the values from the environment:
 *   - LEGACY_APP_HOSTS  — comma-separated hostnames that should 308 to canonical
 *                         (e.g. "app.civicflowapp.com"). UNSET ⇒ no redirect,
 *                         so shipping this before the new domain is live is a
 *                         no-op on production.
 *   - CANONICAL_APP_URL — explicit canonical base; falls back to NEXTAUTH_URL,
 *                         which is the app's canonical public URL post-cutover.
 */

// Endpoints external callers still hit on the old host until they've been
// repointed and verified — never 308 these, or an in-flight webhook/cron/mobile
// request would be bounced to a host the caller hasn't been told about yet.
// The universal-link verification files must also keep resolving on both hosts.
const REDIRECT_EXEMPT_PREFIXES = [
  "/api/webhooks/",
  "/api/cron/",
  "/api/mobile/",
  "/.well-known/",
];

export function parseLegacyHosts(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns the absolute URL to redirect to, preserving path + query and forcing
 * the canonical host/protocol — or null when no redirect should happen
 * (feature not enabled, request isn't on a legacy host, already canonical, or
 * an exempt endpoint).
 */
export function computeLegacyRedirectTarget(input: {
  url: string;
  legacyHosts: string[];
  canonicalBase: string | undefined;
}): string | null {
  const { url, legacyHosts, canonicalBase } = input;
  if (legacyHosts.length === 0 || !canonicalBase) return null;

  let reqUrl: URL;
  let canonical: URL;
  try {
    reqUrl = new URL(url);
    canonical = new URL(canonicalBase);
  } catch {
    return null;
  }

  const host = reqUrl.hostname.toLowerCase();
  if (!legacyHosts.includes(host)) return null;
  // Guard against a misconfigured legacy list that includes the canonical host
  // — redirecting a host to itself is an infinite loop.
  if (canonical.hostname.toLowerCase() === host) return null;
  if (REDIRECT_EXEMPT_PREFIXES.some((p) => reqUrl.pathname.startsWith(p))) return null;

  reqUrl.protocol = canonical.protocol;
  reqUrl.host = canonical.host;
  return reqUrl.toString();
}
