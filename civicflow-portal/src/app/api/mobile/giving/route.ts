import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { getGivingSettings } from "@/lib/giving/module";
import { getProcessingCostCoverageSettings } from "@/lib/giving/processing-cost-coverage";
import { listMySchedules } from "@/lib/giving/recurring";
import { listMyPledges } from "@/lib/giving/pledges";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/giving?organizationId=...
 * CORE-GIVE-L — the member's entire giving surface in one round trip,
 * scoped to the CALLER's own data (memberId/userId re-verified by the
 * mobile guard). Module off → { enabled: false } and nothing else.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");
    const { session, organizationId: verifiedOrgId, memberId } = await requireMobileMembership(request, organizationId);

    const settings = await getGivingSettings(verifiedOrgId);
    if (!settings.contributionsEnabled) {
      return Response.json({ ok: true, data: { enabled: false } });
    }

    const yearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
    const [coverageSettings, funds, history, schedules, pledges, statements, yearRows] = await Promise.all([
      getProcessingCostCoverageSettings(verifiedOrgId),
      prisma.fund.findMany({
        where: { organizationId: verifiedOrgId, status: "ACTIVE", allowOneTime: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          description: true,
          suggestedAmounts: true,
          minimumAmount: true,
          maximumAmount: true,
          allowRecurring: true,
          allowPledges: true,
        },
      }),
      prisma.contribution.findMany({
        where: {
          organizationId: verifiedOrgId,
          voidedAt: null,
          OR: [{ memberId }, { contributorUserId: session.userId }],
        },
        orderBy: { contributionDate: "desc" },
        select: {
          id: true,
          contributionNumber: true,
          amount: true,
          refundedAmount: true,
          contributionDate: true,
          fund: { select: { name: true } },
          campaign: { select: { name: true } },
        },
        take: 25,
      }),
      listMySchedules(verifiedOrgId, session.userId),
      listMyPledges(verifiedOrgId, session.userId),
      prisma.contributionStatement.findMany({
        where: {
          organizationId: verifiedOrgId,
          OR: [{ memberId }, { contributorUserId: session.userId }],
        },
        orderBy: [{ year: "desc" }, { version: "desc" }],
        select: { id: true, year: true, version: true, status: true, totalAmount: true },
        take: 20,
      }),
      prisma.contribution.findMany({
        where: {
          organizationId: verifiedOrgId,
          voidedAt: null,
          contributionDate: { gte: yearStart },
          OR: [{ memberId }, { contributorUserId: session.userId }],
        },
        select: { amount: true, refundedAmount: true },
      }),
    ]);

    return Response.json({
      ok: true,
      data: {
        enabled: true,
        terminology: settings.terminology,
        // MOBILE-COVER: the org's voluntary coverage offer, for the native
        // toggle + live estimate ONLY — the checkout routes re-quote
        // authoritatively server-side (same contract as /pay/[slug]).
        coverage: {
          offered: coverageSettings.mode === "OPTIONAL_CONTRIBUTOR_COVERAGE",
          percentBps: coverageSettings.percentBps,
          fixedCents: coverageSettings.fixedCents,
        },
        yearTotal: yearRows.reduce((sum, row) => sum + Number(row.amount) - Number(row.refundedAmount ?? 0), 0),
        funds: funds.map((fund) => ({
          id: fund.id,
          name: fund.name,
          description: fund.description,
          suggestedAmounts: fund.suggestedAmounts.map((value) => Number(value)),
          minimumAmount: fund.minimumAmount !== null ? Number(fund.minimumAmount) : null,
          maximumAmount: fund.maximumAmount !== null ? Number(fund.maximumAmount) : null,
          allowRecurring: fund.allowRecurring,
          allowPledges: fund.allowPledges,
        })),
        history: history.map((row) => ({
          id: row.id,
          contributionNumber: row.contributionNumber,
          amount: Number(row.amount),
          refundedAmount: row.refundedAmount !== null ? Number(row.refundedAmount) : null,
          date: row.contributionDate.toISOString(),
          designation: row.fund?.name ?? row.campaign?.name ?? "General",
        })),
        schedules: schedules.map((schedule) => ({
          id: schedule.id,
          fundName: schedule.fund.name,
          amount: Number(schedule.amount),
          frequency: schedule.frequency,
          status: schedule.status,
          nextContributionDate: schedule.nextContributionDate?.toISOString() ?? null,
          paymentMethodDescriptor: schedule.paymentMethodDescriptor,
          coverProcessingCosts: schedule.coverProcessingCosts,
        })),
        pledges: pledges.map((pledge) => ({
          id: pledge.id,
          fundId: pledge.fundId,
          fundName: pledge.fundName,
          campaignName: pledge.campaignName,
          pledged: pledge.pledged,
          contributed: pledge.contributed,
          remainingTowardPledge: pledge.remainingTowardPledge,
          progressPercent: pledge.progressPercent,
          status: pledge.status,
        })),
        statements: statements.map((statement) => ({
          id: statement.id,
          year: statement.year,
          version: statement.version,
          status: statement.status,
          total: Number(statement.totalAmount),
        })),
      },
    });
  });
}
