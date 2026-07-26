import Link from "next/link";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { getPtaDashboardMetrics } from "@/lib/labs/pta/dashboard";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { StatusPill, EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function getValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

const STATUS_TONE: Record<string, string> = {
  PENDING: "warning",
  PARTIAL: "warning",
  PAID: "healthy",
  WAIVED: "info",
  VOID: "unknown",
  NO_CHARGE: "unknown",
};

export default async function PtaDuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId, access } = await getPtaPageGate("pta:dues:manage");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Dues &amp; Payments" description="Not available for this organization." />
      </main>
    );
  }

  const profile = await getPtaProfile(organizationId);
  if (!profile) {
    return (
      <main className="space-y-6">
        <PtaLabsBadge />
        <PageHeader title="Dues &amp; Payments" />
        <EmptyState title="Set up your PTA profile first" description="Configure your current school year at Settings." />
      </main>
    );
  }

  const params = await searchParams;
  const statusFilter = getValue(params.status);

  const [metrics, households] = await Promise.all([
    getPtaDashboardMetrics(organizationId, profile.currentSchoolYear),
    prisma.ptaHousehold.findMany({
      where: { organizationId, schoolYear: profile.currentSchoolYear, status: "ACTIVE" },
      select: {
        id: true,
        displayName: true,
        orgMemberId: true,
        orgMember: {
          select: {
            duesCharges: {
              where: { organizationId },
              orderBy: { periodStart: "desc" },
              take: 1,
              select: { status: true, amountDue: true, amountPaid: true, dueDate: true },
            },
          },
        },
      },
      orderBy: { displayName: "asc" },
    }),
  ]);

  const rows = households.map((h) => {
    const charge = h.orgMember?.duesCharges[0];
    return {
      id: h.id,
      displayName: h.displayName,
      status: charge?.status ?? "NO_CHARGE",
      amountDue: charge ? Math.round(Number(charge.amountDue) * 100) : 0,
      amountPaid: charge ? Math.round(Number(charge.amountPaid) * 100) : 0,
      dueDate: charge?.dueDate ?? null,
    };
  });
  const filteredRows = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows;

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Dues &amp; Payments"
        description="Outstanding balances across all households. Create a charge, waive one, or record an offline payment from a household's own page."
        actions={[{ href: "/payment-reports", label: "Payment Reports queue" }]}
      />

      <SectionCard title="Overview">
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Outstanding dues" value={centsToDollars(metrics.outstandingDuesCents)} />
          <StatCard label="Paid households" value={metrics.paidHouseholds} />
          <StatCard
            label="Pending payment reports"
            value={metrics.pendingPaymentReportsCount}
            helper={
              metrics.pendingPaymentReportsCount > 0 ? (
                <Link href="/payment-reports" className="text-emerald-700 hover:underline">
                  Review in Payment Reports →
                </Link>
              ) : undefined
            }
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Parent-reported payments are approved from the base platform&apos;s Payment Reports queue (shared across the whole organization, not PTA-specific) — approving one there is what actually updates a
          household&apos;s charge status.
        </p>
      </SectionCard>

      <SectionCard title="Households by dues status" description={`${filteredRows.length} of ${rows.length} household(s) shown.`}>
        <form method="GET" className="mb-4 flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Status</span>
            <select name="status" defaultValue={statusFilter} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">All</option>
              <option value="NO_CHARGE">No charge yet</option>
              <option value="PENDING">Unpaid</option>
              <option value="PARTIAL">Partially paid</option>
              <option value="PAID">Paid</option>
              <option value="WAIVED">Waived</option>
              <option value="VOID">Voided</option>
            </select>
          </label>
          <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
            Filter
          </button>
          {statusFilter ? (
            <Link href="/labs/pta/dues" className="text-sm font-semibold text-emerald-700 hover:underline">
              Clear
            </Link>
          ) : null}
        </form>

        {filteredRows.length === 0 ? (
          <EmptyState title="No households match this filter" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-4 py-2">Household</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Paid</th>
                  <th className="px-4 py-2">Due</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2 font-semibold text-emerald-700">
                      <Link href={`/labs/pta/households/${r.id}#dues`} className="hover:underline">
                        {r.displayName}
                      </Link>
                    </td>
                    <td className="px-4 py-2"><StatusPill status={STATUS_TONE[r.status] ?? "unknown"} label={r.status.replace(/_/g, " ")} /></td>
                    <td className="px-4 py-2 text-slate-700">{centsToDollars(r.amountPaid)}</td>
                    <td className="px-4 py-2 text-slate-700">{centsToDollars(r.amountDue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </main>
  );
}
