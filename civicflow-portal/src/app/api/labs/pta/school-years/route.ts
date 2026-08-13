import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { createSchoolYear, getSchoolYearContext } from "@/lib/labs/pta/school-years";
import { parseJsonBody, z } from "@/lib/validation";

/** GET /api/labs/pta/school-years — years + current/previous/next context.
 * Board-view is the read bar: anyone who can see the roster can see years. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:board:view");
    const context = await getSchoolYearContext(organizationId);
    return Response.json({ ok: true, data: context });
  });
}

const bodySchema = z.object({
  label: z.string().min(1).max(20),
  startsOn: z.coerce.date().nullable().optional(),
  endsOn: z.coerce.date().nullable().optional(),
  makeCurrent: z.boolean().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:school-years:manage");
    const input = await parseJsonBody(request, bodySchema);
    const year = await createSchoolYear({
      organizationId,
      label: input.label,
      startsOn: input.startsOn ?? null,
      endsOn: input.endsOn ?? null,
      makeCurrent: input.makeCurrent ?? false,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: year }, { status: 201 });
  });
}
