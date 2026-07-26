import { prisma } from "@/lib/prisma";

/**
 * PTA meeting minutes reuse the existing Meeting + Attachment models
 * unchanged — a Meeting's approved-minutes document is just an Attachment
 * with entityType MEETING and purpose "approved_minutes". This is
 * deliberately independent of Meeting Intelligence's MeetingMinutesDraft
 * pipeline (an AI-generation concept) — the PTA vertical must never depend
 * on, or implicitly require, Meeting Intelligence being enrolled.
 *
 * The staff-facing Attachment route already gates MEETING attachments by the
 * "meetings:read" permission, which a plain parent (MEMBER role, zero
 * permissions by design) never holds — so parents need a separate,
 * household-authorized read path. This module is that path: it returns only
 * attachments explicitly marked purpose: "approved_minutes", never a draft,
 * never any other attachment on the meeting.
 */
export async function listApprovedPtaMinutes(organizationId: string) {
  return prisma.attachment.findMany({
    where: { organizationId, entityType: "MEETING", purpose: "approved_minutes", deletedAt: null },
    orderBy: { uploadedAt: "desc" },
  });
}

/**
 * Parent-safe document list — deliberately scoped to ONLY attachments
 * explicitly marked `purpose: "pta_document"` on the organization itself
 * (bylaws, budget, etc. — the "PTA documents" the demo seed creates), never
 * every attachment in the org. There is no existing parent-facing document
 * read path today (the generic `/documents` admin UI is gated by a staff
 * permission, same as meetings) — this is genuinely new, narrowly-scoped
 * surface area, not a bridge onto something parents already had access to.
 *
 * The seeded documents' `objectKey` values are fictional placeholders
 * (`seed-fixtures/pta/...`) with no real file behind them — callers of this
 * function must not attempt to actually fetch/download the object; render
 * an honest "not available in this demo" state instead (see
 * docs/mobile-architecture.md's Documents section).
 */
export async function listPtaOrganizationDocuments(organizationId: string) {
  return prisma.attachment.findMany({
    where: { organizationId, entityType: "ORGANIZATION", entityId: organizationId, purpose: "pta_document", deletedAt: null },
    orderBy: { uploadedAt: "desc" },
  });
}
