import Link from "next/link";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { AttachmentManager } from "@/components/forms/AttachmentManager";
import { ExpenditureVoidControl } from "@/components/expenditures/ExpenditureVoidControl";
import { canVoidFinancialRecord } from "@/lib/financial-edit-policy";
import { formatCurrency, formatDate, formatText } from "@/lib/formatting";

const BASE_PATH = "/labs/pta/finance/expenditures";

export default async function TreasurerExpenditureDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId, access, can, role } = await getPtaPageGate("expenditures:read");
  if (!access.available) return null;
  const { id } = await params;
  const row = await prisma.expenditure.findFirst({
    where: { id, organizationId },
    include: { categoryRef: true, paymentMethodConfig: true, campaign: true, event: true, committee: { select: { id: true, name: true } }, reimbursement: { select: { id: true, payeeName: true } } },
  });

  if (!row) {
    return <PageHeader title="Expenditure not found" description="The requested expenditure is unavailable." actions={[{ href: BASE_PATH, label: "Back to Expenditures" }]} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={row.description}
        description="Expenditure details and supporting context."
        actions={[
          ...(can("expenditures:write") && !row.voidedAt ? [{ href: `${BASE_PATH}/${row.id}/edit`, label: "Edit Expenditure", tone: "primary" as const }] : []),
          { href: BASE_PATH, label: "Back to Expenditures" },
        ]}
      />
      {row.voidedAt ? (
        <div role="status" className="rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-800">
          <p className="font-semibold">Voided {formatDate(row.voidedAt)}</p>
          {row.voidReason ? <p className="mt-1">{row.voidReason}</p> : null}
        </div>
      ) : null}
      {row.reimbursement ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Created from reimbursement to <span className="font-semibold">{row.reimbursement.payeeName}</span>. This linkage is set automatically when a
          reimbursement is marked paid and cannot be reassigned. See it in{" "}
          <Link href={`/labs/pta/finance/reimbursements?highlight=${row.reimbursement.id}`} className="font-semibold hover:underline">
            Reimbursements
          </Link>
          .
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Amount" value={formatCurrency(row.amount)} />
        <StatCard label="Date" value={formatDate(row.date)} />
        <StatCard label="Vendor / Payee" value={formatText(row.vendor, "Direct expense")} />
        <StatCard label="Category" value={formatText(row.categoryRef?.name ?? row.category, "Uncategorized")} />
      </div>
      <SectionCard title="Payment and Attribution" description="Payment, reference, campaign, event, and committee details.">
        <div className="grid gap-4 md:grid-cols-2">
          <StatCard label="Payment Method" value={formatText(row.paymentMethodConfig?.label ?? row.paymentMethod, "Not recorded")} />
          <StatCard label="Reference" value={formatText(row.reference, "No reference")} />
          <StatCard label="Campaign" value={row.campaign?.name ?? "No campaign"} />
          <StatCard label="Event" value={row.event?.title ?? "No event"} />
          <StatCard label="Committee" value={row.committee?.name ?? row.committeeNameAtPosting ?? "No committee"} helper={row.committee ? undefined : row.committeeNameAtPosting ? "Committee since renamed or archived — name shown as recorded at the time." : undefined} />
        </div>
        {row.receiptUrl ? <p className="mt-4 text-sm"><Link href={row.receiptUrl} className="font-semibold text-emerald-700 hover:underline">View receipt</Link></p> : null}
        {row.notes ? <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-medium text-slate-950">Notes</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{row.notes}</p></div> : null}
      </SectionCard>
      <SectionCard title="Receipt and Supporting Files" description="Upload private receipt images, invoices, approvals, or other expenditure support.">
        <AttachmentManager entityType="EXPENDITURE" entityId={row.id} purpose="EXPENDITURE_RECEIPT" canWrite={can("expenditures:write") && !row.voidedAt} />
      </SectionCard>
      {can("expenditures:write") ? (
        <SectionCard title="Void" description="Correct a mistaken entry without deleting it.">
          <ExpenditureVoidControl expenditureId={row.id} canVoid={canVoidFinancialRecord(role)} alreadyVoided={Boolean(row.voidedAt)} />
        </SectionCard>
      ) : null}
    </div>
  );
}
