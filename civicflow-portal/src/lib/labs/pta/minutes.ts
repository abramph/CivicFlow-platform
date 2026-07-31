import { prisma } from "@/lib/prisma";
import { getApprovedMeetingMinutes } from "@/lib/meeting-minutes";

/**
 * PTA meeting minutes now reuse the general MeetingMinutes approval
 * workflow (src/lib/meeting-minutes.ts), available to every organization.
 *
 * Previously this queried Attachment rows with purpose "approved_minutes" —
 * a filter no application code anywhere ever wrote (only the demo seed
 * script did), so the "approved minutes visible to parents" feature could
 * never produce real data for a real customer. getApprovedMeetingMinutes()
 * only ever selects MeetingMinutes.status APPROVED, which is a real,
 * reachable state now that a real write path (draft -> review -> approve)
 * exists — see src/app/api/meetings/[id]/minutes/**.
 *
 * This is deliberately independent of Meeting Intelligence's
 * MeetingMinutesDraft (an AI-generation concept, internal-only pilot) — the
 * PTA vertical must never depend on, or implicitly require, Meeting
 * Intelligence being enrolled.
 */
export async function listApprovedPtaMinutes(organizationId: string) {
  return getApprovedMeetingMinutes(organizationId);
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
