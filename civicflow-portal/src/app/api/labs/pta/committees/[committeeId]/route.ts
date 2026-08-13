import { withApiErrorHandling } from "@/lib/api-route";
import { requireCommitteeManageOrChair, requirePtaAccess } from "@/lib/labs/pta/guard";
import {
  getPtaCommittee,
  setPtaCommitteeChair,
  setPtaCommitteeCoChair,
  updatePtaCommittee,
  updatePtaCommitteeAsChair,
} from "@/lib/labs/pta/committees";
import { PtaError } from "@/lib/labs/pta/errors";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(_request: Request, { params }: { params: Promise<{ committeeId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:directory:read");
    const { committeeId } = await params;
    const committee = await getPtaCommittee(organizationId, committeeId);
    return Response.json({ ok: true, data: committee });
  });
}

const bodySchema = z.object({
  chairAdultId: z.string().nullable().optional(),
  coChairAdultId: z.string().nullable().optional(),
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(4000).nullable().optional(),
  goals: z.string().max(8000).nullable().optional(),
  meetingSchedule: z.string().max(1000).nullable().optional(),
  status: z.enum(["PLANNING", "ACTIVE", "COMPLETED", "ARCHIVED"]).optional(),
  schoolYearId: z.string().nullable().optional(),
  boardLiaisonAdultId: z.string().nullable().optional(),
});

/** Fields a chair-only caller may touch — everything else (rename, status,
 * year, chair/co-chair/liaison assignment) stays officer authority. */
const CHAIR_ALLOWED_FIELDS = new Set(["description", "goals", "meetingSchedule"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ committeeId: string }> }) {
  return withApiErrorHandling(async () => {
    const { committeeId } = await params;
    const { organizationId, session, isChairOnly } = await requireCommitteeManageOrChair(committeeId);
    const input = await parseJsonBody(request, bodySchema);

    const providedFields = Object.keys(input).filter((key) => input[key as keyof typeof input] !== undefined);

    if (isChairOnly) {
      const forbidden = providedFields.filter((field) => !CHAIR_ALLOWED_FIELDS.has(field));
      if (forbidden.length > 0) {
        throw new PtaError(
          "PTA_VALIDATION_ERROR",
          `Only an officer can change: ${forbidden.join(", ")}. Chairs can edit the description, goals, and meeting schedule of their own committee.`
        );
      }
      const committee = await updatePtaCommitteeAsChair({
        organizationId,
        committeeId,
        description: input.description,
        goals: input.goals,
        meetingSchedule: input.meetingSchedule,
        actorUserId: session.userId,
        actorEmail: session.userEmail,
      });
      return Response.json({ ok: true, data: committee });
    }

    // Officer path — chair/co-chair setters keep their dedicated audit trail;
    // everything else flows through the general update.
    let committee = null;
    if (input.chairAdultId !== undefined) {
      committee = await setPtaCommitteeChair(organizationId, committeeId, input.chairAdultId, session.userId, session.userEmail);
    }
    if (input.coChairAdultId !== undefined) {
      committee = await setPtaCommitteeCoChair(organizationId, committeeId, input.coChairAdultId, session.userId, session.userEmail);
    }
    const generalFields = providedFields.filter((field) => field !== "chairAdultId" && field !== "coChairAdultId");
    if (generalFields.length > 0) {
      committee = await updatePtaCommittee({
        organizationId,
        committeeId,
        name: input.name,
        description: input.description,
        goals: input.goals,
        meetingSchedule: input.meetingSchedule,
        status: input.status,
        schoolYearId: input.schoolYearId,
        boardLiaisonAdultId: input.boardLiaisonAdultId,
        actorUserId: session.userId,
        actorEmail: session.userEmail,
      });
    }
    if (!committee) {
      throw new PtaError("PTA_VALIDATION_ERROR", "No changes provided.");
    }
    return Response.json({ ok: true, data: committee });
  });
}
