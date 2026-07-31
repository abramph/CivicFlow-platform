/**
 * Name of the per-organization, per-browser cookie that hides the dashboard
 * "Finish organization setup" banner once dismissed. A cookie rather than a
 * DB column deliberately avoids a schema migration for what is fundamentally
 * a "don't nag me again" UI preference — the tradeoff is that a different
 * admin on a different device still sees the banner until they dismiss it
 * themselves, which is acceptable for a purely cosmetic dismiss action.
 */
export function setupBannerDismissCookieName(organizationId: string): string {
  return `cf_setup_dismissed_${organizationId}`;
}
