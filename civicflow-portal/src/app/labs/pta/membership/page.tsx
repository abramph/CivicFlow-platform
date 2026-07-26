import { requireOrganization } from "@/lib/auth-guards";
import { getOrganizationLabAccess } from "@/lib/labs/access";
import { prisma } from "@/lib/prisma";
import { getPtaParentDuesSummary } from "@/lib/labs/pta/parent-dues";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { StatusPill, EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { formatDateTime } from "@/lib/formatting";
import { PtaReportPaymentForm } from "@/components/labs/pta/PtaReportPaymentForm";
import type { PtaParentDuesChargeSummary } from "@/lib/labs/pta/parent-dues";

const STATUS_LABELS: Record<string, string> = {
  NO_CHARGE: "No charge yet",
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  WAIVED: "Waived",
  VOIDED: "Voided",
  PENDING_REVIEW: "Pending officer review",
};

const STATUS_TONE: Record<string, string> = {
  UNPAID: "degraded",
  PARTIALLY_PAID: "warning",
  PAID: "healthy",
  WAIVED: "info",
  VOIDED: "unknown",
  PENDING_REVIEW: "warning",
};

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function ChargeCard({ charge, title }: { charge: PtaParentDuesChargeSummary; title: string }) {
  return (
    <SectionCard title={title}>
      <div className="mb-4 flex items-center gap-3">
        <StatusPill status={STATUS_TONE[charge.status] ?? "unknown"} label={STATUS_LABELS[charge.status] ?? charge.status} />
        <span className="text-sm text-slate-600">Due {formatDateTime(charge.dueDate)}</span>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Amount due" value={centsToDollars(charge.amountDueCents)} />
        <StatCard label="Amount paid" value={centsToDollars(charge.amountPaidCents)} />
        <StatCard label="Remaining balance" value={centsToDollars(charge.remainingBalanceCents)} />
      </div>

      {charge.payments.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold text-slate-900">Payment history</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {charge.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <span className="text-slate-900">{centsToDollars(p.amountCents)} via {p.method}</span>
                <span className="text-slate-500">{formatDateTime(p.paymentDate)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {charge.adjustments.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold text-slate-900">Adjustments</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {charge.adjustments.map((a) => (
              <li key={a.id} className="py-2">
                <span className="font-medium text-slate-900">{a.type.replace(/_/g, " ")}</span>
                <span className="text-slate-600"> — {centsToDollars(a.amountCents)} — {a.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </SectionCard>
  );
}

export default async function PtaMembershipPage() {
  const { organizationId, session } = await requireOrganization();
  const access = await getOrganizationLabAccess(organizationId, "ptaVertical");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="My PTA Membership" description="Not available for this organization." />
      </main>
    );
  }

  const adult = await prisma.ptaHouseholdAdult.findFirst({
    where: { organizationId, userId: session.userId },
    include: { household: { select: { id: true, status: true } } },
  });

  if (!adult) {
    return (
      <main className="space-y-6">
        <PtaLabsBadge />
        <PageHeader title="My PTA Membership" />
        <EmptyState title="No linked household" description="Your account isn't linked to a PTA household yet — contact your PTA officer." />
      </main>
    );
  }

  if (adult.household.status !== "ACTIVE") {
    return (
      <main className="space-y-6">
        <PtaLabsBadge />
        <PageHeader title="My PTA Membership" />
        <EmptyState title="Membership not currently active" description="Your household's PTA membership is not currently active. Contact your PTA officer if you believe this is a mistake." />
      </main>
    );
  }

  const summary = await getPtaParentDuesSummary(organizationId, adult.householdId);

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="My PTA Membership"
        description={summary.schoolOrPtaName ? `${summary.schoolOrPtaName} — ${summary.currentSchoolYear ?? "current school year"}` : undefined}
      />

      {!summary.hasBillingIdentity ? (
        <EmptyState title="Membership not yet set up" description="Your household doesn't have a dues record yet — contact your PTA officer." />
      ) : summary.currentCharge ? (
        <ChargeCard charge={summary.currentCharge} title="Current dues" />
      ) : (
        <SectionCard title="Current dues">
          <EmptyState title="No dues charge yet" description="Your PTA hasn't created a dues charge for your household this year. Check back later or contact your PTA officer." />
        </SectionCard>
      )}

      {summary.hasBillingIdentity && summary.currentCharge ? (
        <SectionCard title="Payment options" description="Open a payment option below, or report a payment you already made another way.">
          {summary.onlinePaymentLinkSlug ? (
            <a
              href={`/pay/${summary.onlinePaymentLinkSlug}`}
              className="inline-block rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              Open payment option
            </a>
          ) : (
            <p className="mb-4 text-sm text-slate-600">Online payment isn&apos;t configured for this PTA yet. Please use one of the payment methods your PTA has shared with you, then let us know below.</p>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Payments made through an external payment method may remain pending until reviewed and approved by a PTA officer.
          </p>
          <div className="mt-4">
            <PtaReportPaymentForm duesChargeId={summary.currentCharge.id} />
          </div>
        </SectionCard>
      ) : null}

      {summary.priorCharges.length > 0 ? (
        <SectionCard title="Prior periods">
          <div className="space-y-4">
            {summary.priorCharges.map((charge) => (
              <ChargeCard key={charge.id} charge={charge} title={charge.periodStart ? `${new Date(charge.periodStart).getFullYear()} membership` : "Prior membership"} />
            ))}
          </div>
        </SectionCard>
      ) : null}
    </main>
  );
}
