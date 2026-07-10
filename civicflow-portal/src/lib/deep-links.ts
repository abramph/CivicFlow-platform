/**
 * Allow-list of mobile app deep link destinations. Used to validate any
 * `deepLink` value before it's saved on a CommunicationCampaign or included
 * in a push notification payload — a deep link destination is never trusted
 * blindly (spec security requirement).
 *
 * Keep this in sync with civicflow-mobile/src/lib/deep-links.ts.
 */
const ALLOWED_DEEP_LINK_PATTERNS: RegExp[] = [
  /^\/report-payment$/,
  /^\/dues$/,
  /^\/announcements$/,
  /^\/events$/,
  /^\/payment-history$/,
  /^\/messages$/,
  /^\/messages\/[A-Za-z0-9_-]+$/,
  // Member-facing mobile app destinations (civicflow-mobile) — distinct from
  // the staff-only /messages/[id] web inbox above.
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
  /^\/accept-invite(\?.*)?$/,
  /^\/organization\/[A-Za-z0-9_-]+$/,
];

/** The only hostname https/http universal-link values are trusted from. */
const ALLOWED_DEEP_LINK_HOST = "app.civicflowapp.com";

/**
 * Accepts a unestra://, https://app.civicflowapp.com/, or bare "/path"
 * value and returns it unchanged if it resolves to an allow-listed in-app
 * path, otherwise null.
 */
export function validateDeepLink(value: string | null | undefined): string | null {
  if (!value) return null;
  let path: string;
  try {
    if (value.startsWith("/")) {
      path = value;
    } else {
      const parsed = new URL(value);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        if (parsed.hostname !== ALLOWED_DEEP_LINK_HOST) return null;
        path = `/${parsed.pathname.replace(/^\/+/, "")}`;
      } else {
        path = `/${[parsed.host, parsed.pathname.replace(/^\/+/, "")].filter(Boolean).join("/")}`;
      }
      path += parsed.search;
    }
  } catch {
    return null;
  }

  return ALLOWED_DEEP_LINK_PATTERNS.some((pattern) => pattern.test(path)) ? value : null;
}
