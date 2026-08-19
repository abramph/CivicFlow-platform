import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import {
  cancelSchedule,
  changeAmount,
  pauseSchedule,
  resumeSchedule,
  retryFailedPayment,
  setProcessingCostCoverage,
} from "@/lib/giving/recurring-self-service";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  scheduleId: z.string().min(1).max(64),
  action: z.enum(["pause", "resume", "cancel", "change-amount", "retry", "coverage"]),
  amount: z.number().positive().max(1_000_000).nullable().optional(),
  reason: z.string().max(200).nullable().optional(),
  /** MOBILE-COVER: only the boolean preference — the D lib re-grosses at the
   * org's CURRENT rate server-side, same as the web member toggle (§41). */
  coverProcessingCosts: z.boolean().optional(),
});

/**
 * CORE-GIVE-L — mobile recurring self-service. Wraps the D lib unchanged:
 * ownership lives in the query (someone else's schedule is a 404), the
 * provider is mutated first, and failure copy never implies debt (§16).
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, bodySchema);
    const { session: mobileSession, organizationId } = await requireMobileMembership(request, input.organizationId);
    const base = { organizationId, contributorUserId: mobileSession.userId, scheduleId: input.scheduleId };

    switch (input.action) {
      case "pause":
        await pauseSchedule(base);
        break;
      case "resume":
        await resumeSchedule(base);
        break;
      case "cancel":
        await cancelSchedule({ ...base, reason: input.reason ?? null });
        break;
      case "change-amount": {
        if (!input.amount) return Response.json({ ok: false, error: "An amount is required." }, { status: 400 });
        await changeAmount({ ...base, newAmount: input.amount });
        break;
      }
      case "retry":
        await retryFailedPayment(base);
        break;
      case "coverage": {
        if (typeof input.coverProcessingCosts !== "boolean") {
          return Response.json({ ok: false, error: "coverProcessingCosts is required." }, { status: 400 });
        }
        await setProcessingCostCoverage({ ...base, coverProcessingCosts: input.coverProcessingCosts });
        break;
      }
    }
    return Response.json({ ok: true });
  });
}
