import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { listMySchedules } from "@/lib/giving/recurring";

/** CORE-GIVE-C — the member's own recurring schedules. Query-scoped to the
 * caller; management actions arrive in CORE-GIVE-D. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const memberSession = await requireMemberWebSession(searchParams.get("org") ?? "");
    const schedules = await listMySchedules(memberSession.organizationId, memberSession.userId);
    return Response.json({
      ok: true,
      data: schedules.map((schedule) => ({
        id: schedule.id,
        fundName: schedule.fund.name,
        programName: schedule.contributionProgram?.name ?? null,
        amount: Number(schedule.amount),
        frequency: schedule.frequency,
        status: schedule.status,
        nextContributionDate: schedule.nextContributionDate,
        paymentMethodDescriptor: schedule.paymentMethodDescriptor,
        lastSuccessfulContributionAt: schedule.lastSuccessfulContributionAt,
      })),
    });
  });
}
