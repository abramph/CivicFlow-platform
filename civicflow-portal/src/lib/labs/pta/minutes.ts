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
