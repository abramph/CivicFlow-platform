import { notFound } from "next/navigation";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { listAssessmentBatches, getAssessmentBatch } from "@/lib/labs/pta/volunteer-hours/assessments";
import { listPeriodAssignments } from "@/lib/labs/pta/volunteer-hours/assignments";
import { listReviewFlags } from "@/lib/labs/pta/volunteer-hours/corrections";
import { listPeriodDisputes } from "@/lib/labs/pta/volunteer-hours/disputes";
import { checkVolunteerHoursAvailable } from "@/lib/labs/pta/volunteer-hours/guard";
import { getVolunteerRequirementPeriod } from "@/lib/labs/pta/volunteer-hours/periods";
import { listPricingWindows } from "@/lib/labs/pta/volunteer-hours/pricing";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaVolunteerAssessmentManager } from "@/components/labs/pta/PtaVolunteerAssessmentManager";
import { PtaVolunteerAssignmentsManager } from "@/components/labs/pta/PtaVolunteerAssignmentsManager";
import { PtaVolunteerDisputesManager } from "@/components/labs/pta/PtaVolunteerDisputesManager";
import { PtaVolunteerOfflinePaymentForm } from "@/components/labs/pta/PtaVolunteerOfflinePaymentForm";
import { PtaVolunteerPricingWindowsManager } from "@/components/labs/pta/PtaVolunteerPricingWindowsManager";
import { PtaVolunteerReviewFlagsManager } from "@/components/labs/pta/PtaVolunteerReviewFlagsManager";

export default async function PtaVolunteerPeriodAssignmentsPage({ params }: { params: Promise<{ periodId: string }> }) {
  const { organizationId, access, can } = await getPtaPageGate("pta:volunteer-requirements:view");
  const { periodId } = await params;

  if (!access.available || !(await checkVolunteerHoursAvailable(organizationId, "requirements"))) {
    return (
      <main className="space-y-6">
        <PageHeader title="Volunteer requirement period" description="Not available for this organization." />
      </main>
    );
  }

  const period = await getVolunteerRequirementPeriod(organizationId, periodId).catch(() => null);
  if (!period) notFound();

  const canViewPricing = can("pta:volunteer-buyout-pricing:manage");
  const buyoutAvailable = canViewPricing && (await checkVolunteerHoursAvailable(organizationId, "buyout"));
  const canRecordOfflinePayments = can("pta:volunteer-payments:record-offline") && buyoutAvailable;
  const canManageAssessments = can("pta:volunteer-assessments:preview-post") && (await checkVolunteerHoursAvailable(organizationId, "assessments"));

  const [assignments, pricingWindows, disputes, assessmentBatches, reviewFlags] = await Promise.all([
    listPeriodAssignments(organizationId, periodId),
    buyoutAvailable ? listPricingWindows(organizationId, periodId) : Promise.resolve([]),
    listPeriodDisputes(organizationId, periodId),
    canManageAssessments ? listAssessmentBatches(organizationId, periodId) : Promise.resolve([]),
    can("pta:volunteer-requirements:view") ? listReviewFlags(organizationId, periodId) : Promise.resolve([]),
  ]);
  const draftBatchSummary = assessmentBatches.find((b) => b.status === "DRAFT");
  const draftBatch = draftBatchSummary ? await getAssessmentBatch(organizationId, draftBatchSummary.id) : null;

  return (
    <main className="space-y-6">
      <PageHeader
        title={period.name}
        description={`Assignment rules and pricing for this requirement period — how the ${(period.requiredMinutesDefault / 60).toString()}-hour default is adjusted per family, and (once buyouts are turned on) what it costs to buy out hours.`}
        actions={[{ href: "/labs/pta/settings", label: "Back to settings" }]}
      />
      <SectionCard title="Assignment rules & preview" description="Custom hours, exemptions, reductions, and waivers, plus a full per-family preview.">
        <PtaVolunteerAssignmentsManager
          periodId={periodId}
          assignments={assignments.map((a) => ({ ...a, exemptUntil: a.exemptUntil?.toISOString() ?? null }))}
          canManageScopeRules={can("pta:volunteer-requirements:manage")}
          canAdjustFamily={can("pta:volunteer-requirements:adjust-family")}
        />
      </SectionCard>
      {buyoutAvailable ? (
        <SectionCard
          title="Pricing windows"
          description="Time-based rates for buying out volunteer hours. The server always resolves the price at checkout — nothing here is ever trusted from a family's browser."
        >
          <PtaVolunteerPricingWindowsManager
            periodId={periodId}
            windows={pricingWindows.map((w) => ({ ...w, startAt: w.startAt.toISOString(), endAt: w.endAt.toISOString() }))}
            canManage={canViewPricing}
          />
        </SectionCard>
      ) : null}
      {canRecordOfflinePayments ? (
        <SectionCard
          title="Record an offline buyout payment"
          description="Cash, check, Zelle, Cash App, or other approved offline payment. Purchased hours are credited immediately — this is the verification step."
        >
          <PtaVolunteerOfflinePaymentForm periodId={periodId} />
        </SectionCard>
      ) : null}
      {canManageAssessments ? (
        <SectionCard
          title="Remaining-hours assessment"
          description="Preview, review, and post charges for hours left unmet at period end. Posting is duplicate-proof and creates one obligation per included family."
        >
          <PtaVolunteerAssessmentManager
            periodId={periodId}
            draftBatch={
              draftBatch
                ? {
                    ...draftBatch,
                    createdAt: draftBatch.createdAt.toISOString(),
                    lines: draftBatch.lines.map((l) => ({ ...l })),
                  }
                : null
            }
          />
        </SectionCard>
      ) : null}
      <SectionCard title="Family-reported issues" description="Missing or incorrect volunteer records reported by families for this period.">
        <PtaVolunteerDisputesManager
          periodId={periodId}
          disputes={disputes.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))}
        />
      </SectionCard>
      <SectionCard
        title="Flagged for review"
        description="Corrections after an assessment posted, possible overpayments, or refunds that leave a family short — spec-required human review, never automatic charges or refunds."
      >
        <PtaVolunteerReviewFlagsManager periodId={periodId} flags={reviewFlags.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() }))} />
      </SectionCard>
    </main>
  );
}
