import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { createReimbursement, listReimbursements } from "@/lib/reimbursements";
import { parseJsonBody, z } from "@/lib/validation";

const STATUSES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "PAID", "REJECTED"] as const;

/** GET /api/reimbursements[?status=] — managers see all; submitters see
 * exactly their own (enforced in the lib's where clause). */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session, can } = await requirePermission("reimbursements:submit", "throw");
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status");
    const status = STATUSES.includes(statusParam as (typeof STATUSES)[number]) ? (statusParam as (typeof STATUSES)[number]) : undefined;
    const rows = await listReimbursements(
      organizationId,
      { userId: session.userId, canManage: can("reimbursements:manage") },
      { status }
    );
    return Response.json({ ok: true, data: rows });
  });
}

const createSchema = z.object({
  payeeName: z.string().min(1).max(200),
  description: z.string().min(1).max(4000),
  amount: z.number().positive().max(100_000_000),
  categoryId: z.string().max(64).nullable().optional(),
  eventId: z.string().max(64).nullable().optional(),
  committeeId: z.string().max(64).nullable().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("reimbursements:submit", "throw");
    const input = await parseJsonBody(request, createSchema);
    const reimbursement = await createReimbursement({
      organizationId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: reimbursement }, { status: 201 });
  });
}
