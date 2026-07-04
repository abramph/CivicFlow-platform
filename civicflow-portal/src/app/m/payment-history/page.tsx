import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { formatCurrency, formatDate, formatEnumLabel } from "@/lib/formatting";
import { getMemberWebSession } from "@/lib/member-web-session";
import { prisma } from "@/lib/prisma";

export default async function MemberPaymentHistoryPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="payment-history" title="Payment History" />
      </div>
    );
  }

  const [payments, reports] = await Promise.all([
    prisma.duesPayment.findMany({
      where: { organizationId: memberSession.organizationId, memberId: memberSession.memberId },
      orderBy: { paymentDate: "desc" },
      take: 50,
    }),
    prisma.paymentReport.findMany({
      where: { organizationId: memberSession.organizationId, memberId: memberSession.memberId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const rows = [
    ...payments.map((p) => ({ id: `payment-${p.id}`, date: p.paymentDate, amount: p.amount, label: `Confirmed · ${formatEnumLabel(p.method)}` })),
    ...reports.map((r) => ({ id: `report-${r.id}`, date: r.paymentDate, amount: r.amount, label: `Reported · ${formatEnumLabel(r.paymentMethod)} · ${formatEnumLabel(r.status)}` })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">Payment History</h1>
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-600">No payments or reports yet.</p>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="px-4 py-3 text-sm">
                <p className="font-semibold text-slate-900">{formatCurrency(row.amount)} · {formatDate(row.date)}</p>
                <p className="text-slate-600">{row.label}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
