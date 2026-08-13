import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { assignOfficer } from "@/lib/labs/pta/board";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z
  .object({
    positionId: z.string().min(1),
    householdAdultId: z.string().min(1).nullable().optional(),
    personName: z.string().max(200).nullable().optional(),
    schoolYearId: z.string().min(1).nullable().optional(),
    status: z.enum(["ACTIVE", "INCOMING"]).optional(),
    startDate: z.coerce.date().nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .refine((value) => Boolean(value.householdAdultId || value.personName?.trim()), {
    message: "Provide either a household adult or a name for the officer.",
  });

/** POST /api/labs/pta/board/assignments — record a position holder. ACTIVE
 * ends the sitting holder's row (history preserved); INCOMING prepares the
 * next board without touching the current one. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:board:manage");
    const input = await parseJsonBody(request, bodySchema);
    const assignment = await assignOfficer({
      organizationId,
      positionId: input.positionId,
      householdAdultId: input.householdAdultId ?? null,
      personName: input.personName ?? null,
      schoolYearId: input.schoolYearId ?? null,
      status: input.status,
      startDate: input.startDate ?? null,
      notes: input.notes ?? null,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: assignment }, { status: 201 });
  });
}
