import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
import {
  cancelSchedule,
  changeAmount,
  changeFrequency,
  pauseSchedule,
  resumeSchedule,
  retryFailedPayment,
  setProcessingCostCoverage,
} from "@/lib/giving/recurring-self-service";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  action: z.enum(["amount", "frequency", "pause", "resume", "cancel", "retry", "coverage"]),
  amount: z.number().positive().max(1_000_000).optional(),
  frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "ANNUALLY"]).optional(),
  reason: z.string().max(40).nullable().optional(),
  coverProcessingCosts: z.boolean().optional(),
});

/**
 * CORE-GIVE-D — self-service on the member's OWN schedule. Ownership is
 * enforced in the lib (contributor + org match → else 404); provider
 * mutations run before any local update; everything is audited and the
 * member is notified.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ scheduleId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:giving:recurring-manage", request, limit: 20, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { scheduleId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const memberSession = await requireMemberWebSession(input.organizationId);
    const base = {
      organizationId: memberSession.organizationId,
      contributorUserId: memberSession.userId,
      scheduleId,
    };

    switch (input.action) {
      case "amount": {
        if (input.amount === undefined) return Response.json({ ok: false, error: "amount is required." }, { status: 400 });
        const schedule = await changeAmount({ ...base, newAmount: input.amount });
        return Response.json({ ok: true, data: schedule });
      }
      case "frequency": {
        if (!input.frequency) return Response.json({ ok: false, error: "frequency is required." }, { status: 400 });
        const schedule = await changeFrequency({ ...base, newFrequency: input.frequency });
        return Response.json({ ok: true, data: schedule });
      }
      case "pause":
        return Response.json({ ok: true, data: await pauseSchedule(base) });
      case "resume":
        return Response.json({ ok: true, data: await resumeSchedule(base) });
      case "cancel":
        return Response.json({ ok: true, data: await cancelSchedule({ ...base, reason: input.reason ?? null }) });
      case "retry":
        return Response.json({ ok: true, data: await retryFailedPayment(base) });
      case "coverage": {
        if (input.coverProcessingCosts === undefined) {
          return Response.json({ ok: false, error: "coverProcessingCosts is required." }, { status: 400 });
        }
        const schedule = await setProcessingCostCoverage({ ...base, coverProcessingCosts: input.coverProcessingCosts });
        return Response.json({ ok: true, data: schedule });
      }
    }
  });
}
