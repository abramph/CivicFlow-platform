import { withApiErrorHandling } from "@/lib/api-route";
import { requireHoaViolationRead, requireHoaViolationWrite } from "@/lib/hoa/violations-guard";
import { createViolationDraft, listViolations } from "@/lib/hoa/violations";
import { parseJsonBody, z } from "@/lib/validation";

const STATUSES = ["DRAFT", "ISSUED", "ACKNOWLEDGED", "IN_REVIEW", "CURED", "RESOLVED", "DISMISSED"] as const;

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireHoaViolationRead();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const propertyId = url.searchParams.get("propertyId");
    const violations = await listViolations(organizationId, {
      status: STATUSES.includes(status as (typeof STATUSES)[number]) ? (status as (typeof STATUSES)[number]) : undefined,
      propertyId: propertyId ?? undefined,
    });
    return Response.json({ ok: true, data: violations });
  });
}

const createSchema = z.object({
  propertyId: z.string().min(1),
  violationType: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  cureByDate: z.string().datetime().nullable().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireHoaViolationWrite();
    const input = await parseJsonBody(request, createSchema);
    const violation = await createViolationDraft({
      organizationId,
      propertyId: input.propertyId,
      violationType: input.violationType,
      description: input.description,
      cureByDate: input.cureByDate ? new Date(input.cureByDate) : null,
      actorUserId: session.userId,
    });
    return Response.json({ ok: true, data: violation }, { status: 201 });
  });
}
