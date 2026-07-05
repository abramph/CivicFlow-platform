import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { paymentMethodLabels as defaultPaymentMethodLabels } from "@/lib/payment-methods";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { ContributionVoidForm } from "@/components/forms/ContributionVoidForm";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatEnumLabel,
  formatPersonName,
  formatText,
} from "@/lib/formatting";

export default async function ContributionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organizationId, can } = await requirePermission("contributions:read");
  const { id } = await params;

  const [contribution, paymentMethods] = await Promise.all([
    prisma.contribution.findFirst({
      where: { id, organizationId },
      include: {
        member: {
          select: { id: true, firstName: true, lastName: true, preferredName: true },
        },
        campaign: { select: { id: true, name: true } },
        event: { select: { id: true, title: true } },
        receipts: { orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId },
      select: { method: true, label: true },
    }),
  ]);

  if (!contribution) notFound();

  const canWrite = can("contributions:write");
  const isVoided = !!contribution.voidedAt;
  const isLocked = !!contribution.lockedAt;

  const methodLabels = Object.fromEntries(defaultPaymentMethodLabels);
  for (const m of paymentMethods) methodLabels[m.method] = m.label;

  const paymentMethodLabel = contribution.paymentMethod
    ? (methodLabels[contribution.paymentMethod] ?? formatEnumLabel(contribution.paymentMethod))
    : "Not specified";

  const actions: Array<{ href: string; label: string; tone?: "primary" | "secondary" }> = [];
  if (!isVoided && canWrite) {
    actions.push({ href: `/contributions/${id}/edit`, label: "Edit", tone: "primary" });
  }
  if (contribution.member) {
    actions.push({ href: `/members/${contribution.member.id}`, label: "View Member" });
  }
  actions.push({ href: "/contributions", label: "All Contributions" });

  return (
    <main className="space-y-6">
      <PageHeader
        title={formatCurrency(contribution.amount)}
        description={`Contribution on ${formatDate(contribution.contributionDate)}${contribution.member ? ` · ${formatPersonName(contribution.member)}` : ""}`}
        actions={actions}
      />

      {isVoided ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
          <p className="font-semibold">This contribution has been voided.</p>
          {contribution.voidReason ? (
            <p className="mt-1">Reason: {contribution.voidReason}</p>
          ) : null}
          <p className="mt-1 text-xs text-red-600">
            Voided {formatDateTime(contribution.voidedAt)}
          </p>
        </div>
      ) : isLocked ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          <p className="font-semibold">This contribution is locked.</p>
          <p className="mt-1">Amount and date cannot be changed. Notes and payment method are still editable.</p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Amount" value={formatCurrency(contribution.amount)} />
        <StatCard label="Date" value={formatDate(contribution.contributionDate)} />
        <StatCard label="Source" value={formatEnumLabel(contribution.source)} />
        <StatCard label="Payment method" value={paymentMethodLabel} />
      </div>

      <SectionCard title="Contribution details" description="Attribution, context, and record metadata.">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Member</dt>
            <dd className="mt-1 text-sm text-slate-900">
              {contribution.member ? (
                <Link
                  href={`/members/${contribution.member.id}`}
                  className="font-semibold text-emerald-700 hover:underline"
                >
                  {formatPersonName(contribution.member)}
                </Link>
              ) : (
                <span className="text-slate-500">{contribution.contributorName || "Non-member"}</span>
              )}
            </dd>
          </div>

          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Campaign</dt>
            <dd className="mt-1 text-sm text-slate-900">
              {contribution.campaign ? (
                <Link
                  href={`/campaigns/${contribution.campaign.id}`}
                  className="text-emerald-700 hover:underline"
                >
                  {contribution.campaign.name}
                </Link>
              ) : (
                <span className="text-slate-500">None</span>
              )}
            </dd>
          </div>

          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Event</dt>
            <dd className="mt-1 text-sm text-slate-900">
              {contribution.event ? (
                <Link
                  href={`/events/${contribution.event.id}`}
                  className="text-emerald-700 hover:underline"
                >
                  {contribution.event.title}
                </Link>
              ) : (
                <span className="text-slate-500">None</span>
              )}
            </dd>
          </div>

          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Receipt requested</dt>
            <dd className="mt-1 text-sm text-slate-900">
              {contribution.receiptRequested ? "Yes" : "No"}
            </dd>
          </div>

          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Revision</dt>
            <dd className="mt-1 text-sm text-slate-900">#{contribution.revisionNumber}</dd>
          </div>

          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recorded</dt>
            <dd className="mt-1 text-sm text-slate-900">{formatDateTime(contribution.createdAt)}</dd>
          </div>

          {contribution.editReason ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last edit reason</dt>
              <dd className="mt-1 text-sm text-slate-900">{contribution.editReason}</dd>
            </div>
          ) : null}

          {contribution.notes ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{formatText(contribution.notes)}</dd>
            </div>
          ) : null}
        </dl>
      </SectionCard>

      {contribution.receipts.length > 0 ? (
        <SectionCard title="Receipts" description="Receipt records attached to this contribution.">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Receipt #</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Delivered</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {contribution.receipts.map((receipt) => (
                <tr key={receipt.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-mono text-slate-900">{receipt.receiptNumber}</td>
                  <td className="px-4 py-3 text-slate-900">{formatEnumLabel(receipt.deliveryStatus)}</td>
                  <td className="px-4 py-3 text-slate-900">{formatDate(receipt.deliveredAt)}</td>
                  <td className="px-4 py-3 text-slate-900">{formatDate(receipt.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      ) : null}

      {!isVoided && canWrite ? (
        <SectionCard
          title="Void contribution"
          description="Voiding cancels this record while preserving it for audit. Use for data entry errors or duplicates."
        >
          <ContributionVoidForm contributionId={id} />
        </SectionCard>
      ) : null}
    </main>
  );
}
