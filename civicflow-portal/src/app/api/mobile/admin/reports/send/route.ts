import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePaymentsPermission } from "@/lib/mobile-admin-payments";
import { PERMISSIONS } from "@/lib/rbac";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { sendMobileReport, sendMobileReportSchema } from "@/lib/mobile-report-send";

const bodySchema = sendMobileReportSchema.extend({ organizationId: z.string().min(1) });

/**
 * POST /api/mobile/admin/reports/send
 * "Email me this report" -- see mobile-report-send.ts for why this is the
 * mobile report-export surface instead of returning file bytes to the app.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:reports:send",
      request,
      limit: 10,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, ...input } = await parseJsonBody(request, bodySchema);
    const { userId, email, role } = await requireMobilePaymentsPermission(request, organizationId, "manageReports", PERMISSIONS.REPORTS_EXPORT);

    const result = await sendMobileReport(organizationId, { userId, email, role }, { ...input, format: input.format ?? "pdf" });
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data });
  });
}
