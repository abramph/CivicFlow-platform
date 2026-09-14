import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Canonical, SERVER-AUTHORITATIVE notification-identity formatter.
 *
 * The mobile app is the trusted installed application ("Unestra"); the
 * organization is the apparent *content sender*, shown as the notification
 * title (like WhatsApp showing a person/group under the WhatsApp identity).
 * Every push-generating path routes its title/subtitle through here instead
 * of setting a title itself, so the identity rules live in exactly one place.
 *
 * Title rules (see docs/mobile-notification-identity.md):
 *   - announcement / event / meeting / dues / volunteer reminder → the
 *     organization's display name.
 *   - direct/member message → "Sender · Organization" when a sender identity
 *     is supplied and authorized, else the organization name.
 *   - platform security/billing/system alert → always "Unestra".
 *
 * The organization name is resolved HERE from the tenant-scoped
 * organizationId — never from a mobile client or request body. If it cannot
 * be resolved safely, the title falls back to the privacy-safe "Unestra"
 * (callers log only identifiers, never names/bodies/tokens).
 */

export const PLATFORM_NOTIFICATION_TITLE = "Unestra";

/** Upper bound on a rendered notification title. Long org names are truncated
 *  on a Unicode code-point boundary (never mid-surrogate/grapheme-splitting). */
export const MAX_NOTIFICATION_TITLE_LENGTH = 64;

export type NotificationCategory =
  // Recommended set from the spec:
  | "ANNOUNCEMENT"
  | "EVENT_REMINDER"
  | "MEETING_REMINDER"
  | "DUES_REMINDER"
  | "VOLUNTEER_REMINDER"
  // Truthful subtitles for the remaining audited org paths (confirmations,
  // status updates, vertical notices) — still organization-titled:
  | "MEETING_UPDATE"
  | "ATTENDANCE"
  | "PAYMENT_UPDATE"
  | "MEMBERSHIP_UPDATE"
  | "NOTICE"
  | "CASE_UPDATE"
  // Person-titled and platform-titled:
  | "DIRECT_MESSAGE"
  | "PLATFORM_ALERT";

/** Human subtitle/category label shown under the title where the platform
 *  supports it (iOS subtitle; carried in `data.category` for all platforms). */
export const NOTIFICATION_CATEGORY_LABEL: Record<NotificationCategory, string | null> = {
  ANNOUNCEMENT: "Announcement",
  EVENT_REMINDER: "Event reminder",
  MEETING_REMINDER: "Meeting reminder",
  DUES_REMINDER: "Payment reminder",
  VOLUNTEER_REMINDER: "Volunteer reminder",
  MEETING_UPDATE: "Meeting update",
  ATTENDANCE: "Attendance",
  PAYMENT_UPDATE: "Payment update",
  MEMBERSHIP_UPDATE: "Membership update",
  NOTICE: "Notice",
  CASE_UPDATE: "Case update",
  DIRECT_MESSAGE: "Message",
  PLATFORM_ALERT: null,
};

/** True when this category's title is the organization (content-sender) rather
 *  than the platform. */
export function isOrganizationTitledCategory(category: NotificationCategory): boolean {
  return category !== "PLATFORM_ALERT";
}

/** Maps a CommunicationCampaign.communicationType to a notification category
 *  for its push subtitle. Every campaign is organization-titled. */
export function campaignNotificationCategory(communicationType: string): NotificationCategory {
  switch (communicationType) {
    case "EVENT_NOTICE":
      return "EVENT_REMINDER";
    case "MEETING_MINUTES":
      return "MEETING_UPDATE";
    case "DUES_REMINDER":
      return "DUES_REMINDER";
    default:
      // ANNOUNCEMENT, CAMPAIGN_UPDATE, GENERAL, OTHER
      return "ANNOUNCEMENT";
  }
}

/** Collapse internal whitespace and trim. */
export function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Grapheme segmenter — the unit a human perceives as one character. Unlike
 * code points (Array.from), grapheme clusters keep combining accents, emoji
 * skin-tone modifiers, regional-indicator flag pairs, and ZWJ family emoji
 * intact. Intl.Segmenter is available on the portal's Node runtime; the
 * code-point fallback is retained only for any environment that lacks it (it
 * still never splits a surrogate pair — it just can't merge multi-scalar
 * clusters).
 */
const graphemeSegmenter: Intl.Segmenter | null =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("und", { granularity: "grapheme" })
    : null;

function toGraphemes(value: string): string[] {
  if (graphemeSegmenter) return Array.from(graphemeSegmenter.segment(value), (s) => s.segment);
  return Array.from(value); // code-point fallback (no grapheme merging, but no split surrogates)
}

/** Truncate on a grapheme-cluster boundary so a visible character (accented
 *  letter, flag, skin-toned or ZWJ emoji) is never split. Appends an ellipsis
 *  when shortened. `max` counts grapheme clusters. */
export function safeTruncate(value: string, max: number): string {
  const graphemes = toGraphemes(value);
  if (graphemes.length <= max) return value;
  return graphemes.slice(0, Math.max(0, max - 1)).join("").trimEnd() + "…";
}

export interface NotificationIdentity {
  /** The rendered notification title. */
  title: string;
  /** Category label for iOS subtitle / `data.category`; null when none. */
  subtitle: string | null;
  category: NotificationCategory;
  /** True when the organization name resolved (false → privacy-safe fallback). */
  organizationResolved: boolean;
}

/**
 * Resolve an organization's display title from its id. Uses the authoritative
 * `Organization.name` (there is no separate short/display-name field, so no
 * acronym is invented). Returns null if the org is missing or unnamed.
 */
export async function resolveOrganizationDisplayName(organizationId: string): Promise<string | null> {
  if (!organizationId) return null;
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  const name = org?.name ? normalizeName(org.name) : "";
  if (!name) return null;
  return safeTruncate(name, MAX_NOTIFICATION_TITLE_LENGTH);
}

/**
 * Resolve a direct-message sender's display name SERVER-side, from the
 * authenticated sender's user id scoped to the tenant — never from a
 * caller/client-supplied string (which the message routes populate from the
 * session EMAIL, an inappropriate identity to surface). Order: the sender's
 * OrgMember first/last name in this org, then their PTA household-adult name in
 * this org; an email address is never returned. Null → the caller shows the
 * organization name alone. A cross-tenant sender (no membership/adult row in
 * THIS org) resolves to null and is never surfaced.
 */
export async function resolveDirectMessageSenderName(
  organizationId: string,
  senderUserId: string
): Promise<string | null> {
  if (!organizationId || !senderUserId) return null;

  const member = await prisma.orgMember.findFirst({
    where: { organizationId, userId: senderUserId },
    select: { firstName: true, lastName: true },
  });
  if (member) {
    const full = normalizeName(`${member.firstName ?? ""} ${member.lastName ?? ""}`);
    if (full && !full.includes("@")) return safeTruncate(full, MAX_NOTIFICATION_TITLE_LENGTH);
  }

  const adult = await prisma.ptaHouseholdAdult.findFirst({
    where: { organizationId, userId: senderUserId, household: { status: "ACTIVE" } },
    select: { name: true },
  });
  if (adult?.name) {
    const name = normalizeName(adult.name);
    if (name && !name.includes("@")) return safeTruncate(name, MAX_NOTIFICATION_TITLE_LENGTH);
  }

  return null;
}

export interface BuildNotificationIdentityInput {
  category: NotificationCategory;
  /** Tenant-scoped organization id; the ONLY trusted source of the org name. */
  organizationId?: string | null;
  /** Sender's display name, for DIRECT_MESSAGE only. MUST already be
   *  server-resolved (see resolveDirectMessageSenderName) — never a raw
   *  client/session string. The email guard below is defense-in-depth. */
  senderName?: string | null;
}

/**
 * Build the notification identity (title + subtitle) for a push, resolving the
 * organization name server-side. Pure of side effects other than the org read.
 */
export async function buildNotificationIdentity(input: BuildNotificationIdentityInput): Promise<NotificationIdentity> {
  const { category } = input;
  const subtitle = NOTIFICATION_CATEGORY_LABEL[category];

  // Platform security/billing/system alerts are always the platform identity.
  if (category === "PLATFORM_ALERT") {
    return { title: PLATFORM_NOTIFICATION_TITLE, subtitle, category, organizationResolved: false };
  }

  const orgName = input.organizationId ? await resolveOrganizationDisplayName(input.organizationId) : null;

  // Privacy-safe fallback: an unresolved org never leaks a wrong/blank name.
  if (!orgName) {
    return { title: PLATFORM_NOTIFICATION_TITLE, subtitle, category, organizationResolved: false };
  }

  if (category === "DIRECT_MESSAGE") {
    const raw = input.senderName ? normalizeName(input.senderName) : "";
    // An email address is not an appropriate person-identity to surface — fall
    // back to the organization name alone.
    const sender = raw && !raw.includes("@") ? raw : "";
    const title = sender ? safeTruncate(`${sender} · ${orgName}`, MAX_NOTIFICATION_TITLE_LENGTH) : orgName;
    return { title, subtitle, category, organizationResolved: true };
  }

  // Announcement / event / meeting / dues / volunteer → the organization name.
  return { title: orgName, subtitle, category, organizationResolved: true };
}
