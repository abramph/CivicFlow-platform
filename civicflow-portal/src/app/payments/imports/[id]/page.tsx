import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { PaymentImportReviewForm } from "@/components/forms/PaymentImportReviewForm";
import { formatCurrency, formatDate, formatDateTime, formatEnumLabel, formatPersonName } from "@/lib/formatting";

export default async function PaymentImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId, can } = await requirePermission("dues:read");
  const canWrite = can("dues:write");
  const { id } = await params;
  const [batch, members, charges, campaigns, events] = await Promise.all([
    prisma.paymentImportBatch.findFirst({
      where: { id, organizationId },
      include: { items: { orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }], include: { matchedMember: true } } },
    }),
    prisma.orgMember.findMany({ where: { organizationId }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true }, take: 1000 }),
    prisma.duesCharge.findMany({ where: { organizationId, status: { in: ["PENDING", "PARTIAL"] } }, orderBy: { dueDate: "asc" }, include: { member: true }, take: 1000 }),
    prisma.campaign.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 }),
    prisma.event.findMany({ where: { organizationId }, orderBy: { startAt: "desc" }, select: { id: true, title: true }, take: 500 }),
  ]);
  if (!batch) return <main><PageHeader title="Import not found" description="The requested payment import was not found." actions={[{ href: "/payments/imports", label: "Back to Imports" }]} /></main>;
  const memberOptions = members.map((member) => ({ id: member.id, label: `${member.lastName}, ${member.firstName}` }));
  const chargeOptions = charges.map((charge) => ({ id: charge.id, label: `${formatPersonName(charge.member)} · ${formatDate(charge.dueDate)} · ${formatCurrency(Number(charge.amountDue) - Number(charge.amountPaid))}` }));
  return (
    <main className="space-y-6">
      <PageHeader title="Payment Import Detail" description="Review matches, verify payments, and post verified items to dues or contributions." actions={[{ href: "/payments/imports", label: "Back to Imports" }, { href: "/payments/reconciliation", label: "Manual Reconciliation" }]} />
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Source" value={formatEnumLabel(batch.sourceType)} />
        <StatCard label="Status" value={formatEnumLabel(batch.status)} />
        <StatCard label="Items" value={batch.items.length} />
        <StatCard label="Uploaded" value={formatDateTime(batch.uploadedAt)} />
      </div>
      <SectionCard title="Imported Items" description="Verified items can be posted once. Posted import records are retained for audit.">
        <div className="space-y-4">
          {batch.items.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="grid gap-3 text-sm md:grid-cols-5">
                <div><p className="font-semibold text-slate-950">{formatCurrency(item.amount)}</p><p className="text-slate-700">{formatDate(item.transactionDate)}</p></div>
                <div><p className="font-semibold text-slate-950">{item.payerName || "No payer"}</p><p className="text-slate-700">{item.payerEmail || item.payerPhone || "-"}</p></div>
                <div><p className="text-slate-700">{item.memo || "-"}</p><p className="text-xs text-slate-600">{item.externalTransactionId || "No transaction id"}</p></div>
                <div><p className="text-slate-700">{item.matchedMember ? formatPersonName(item.matchedMember) : "No match"}</p><p className="text-xs text-slate-600">Confidence {item.matchConfidence ?? 0}%</p></div>
                <div><p className="font-semibold text-slate-950">{formatEnumLabel(item.verificationStatus)}</p><p className="text-xs text-slate-600">{item.postedAs ? `Posted as ${formatEnumLabel(item.postedAs)}` : "Not posted"}</p></div>
              </div>
              {item.verificationStatus === "POSTED" ? (
                <p className="mt-3 text-sm text-slate-700">Posted items are immutable. Use financial correction/void controls for changes.</p>
              ) : (
                <div className="mt-4">
                  <PaymentImportReviewForm batchId={batch.id} item={item} members={memberOptions} charges={chargeOptions} campaigns={campaigns.map((campaign) => ({ id: campaign.id, label: campaign.name }))} events={events.map((event) => ({ id: event.id, label: event.title }))} canWrite={canWrite} />
                </div>
              )}
            </div>
          ))}
          {batch.items.length === 0 ? <p className="text-sm text-slate-600">No items in this import.</p> : null}
        </div>
      </SectionCard>
    </main>
  );
}
