/** Customer-facing product identity. Safe to change freely — does not affect
 * env var names, directory names, domains, or the CF- license key format. */
export const PRODUCT_NAME = "Unestra";
export const TAGLINE = "One organization. Fully connected.";
export const ATTRIBUTION = "An APH Technologies product";
/** Prior public name, for one-time transition messaging only. */
export const LEGACY_NAME = "CivicFlow";

/**
 * Real, monitored mailboxes at the canonical domain (confirmed live —
 * not placeholders). Used as Reply-To / contact addresses across
 * transactional email, SMS help text, and legal pages so they only ever
 * live in one place.
 */
export const SUPPORT_EMAIL = "support@getunestra.com";
export const SECURITY_EMAIL = "security@getunestra.com";
export const NOTIFICATIONS_EMAIL = "notifications@getunestra.com";
