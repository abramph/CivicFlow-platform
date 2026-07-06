import Link from "next/link";
import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { formatCurrency, formatDate, formatEnumLabel } from "@/lib/formatting";
import { getMemberWebSession } from "@/lib/member-web-session";
import { prisma } from "@/lib/prisma";

export default async function MemberDuesPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="dues" title="Your Dues Status" />
      </div>
    );
  }

  const [charges, totals, paymentMethods] = await Promise.all([
    prisma.duesCharge.findMany({
      where: { organizationId: memberSession.organizationId, memberId: memberSession.memberId },
      orderBy: { dueDate: "desc" },
      include: { duesAccount: { select: { name: true } } },
      take: 50,
    }),
    prisma.duesCharge.aggregate({
      where: {
        organizationId: memberSession.organizationId,
        memberId: memberSession.memberId,
        status: { in: ["PENDING", "PARTIAL"] },
      },
      _sum: { amountDue: true, amountPaid: true },
    }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId: memberSession.organizationId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
  ]);

  const outstanding = Math.max(0, Number(totals._sum.amountDue ?? 0) - Number(totals._sum.amountPaid ?? 0));
  // Only surface methods staff actually configured with a handle/instructions —
  // default seeded rows (e.g. "Cash", "Check") have neither and aren't actionable here.
  const payableMethods = paymentMethods.filter((method) => method.accountIdentifier || method.instructions);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">Dues Status</h1>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <p className="text-sm text-slate-600">Outstanding Balance</p>
        <p className="text-3xl font-bold text-slate-900">{formatCurrency(outstanding)}</p>
        <Link href="/m/report-payment" className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
          Report a Payment
        </Link>
      </div>

      {payableMethods.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Ways to Pay</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {payableMethods.map((method) => {
              const isLink = method.accountIdentifier?.startsWith("http://") || method.accountIdentifier?.startsWith("https://");
              return (
                <div key={method.id} className="px-4 py-3 text-sm">
                  <p className="font-semibold text-slate-900">{method.label}</p>
                  {method.accountIdentifier ? (
                    isLink ? (
                      <a
                        href={method.accountIdentifier}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-700 hover:underline"
                      >
                        {method.accountIdentifier}
                      </a>
                    ) : (
                      <p className="text-slate-800">{method.accountIdentifier}</p>
                    )
                  ) : null}
                  {method.instructions ? <p className="mt-1 text-slate-600">{method.instructions}</p> : null}
                </div>
              );
            })}
          </div>
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            After paying, use the button above to report it so your treasurer can confirm it.
          </p>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3"><h2 className="text-sm font-semibold text-slate-900">Charges</h2></div>
        <div className="divide-y divide-slate-100">
          {charges.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-600">No dues charges on file.</p>
          ) : (
            charges.map((charge) => (
              <div key={charge.id} className="px-4 py-3 text-sm">
                <p className="font-semibold text-slate-900">{charge.duesAccount.name}</p>
                <p className="text-slate-600">Due {formatDate(charge.dueDate)} · {formatEnumLabel(charge.status)}</p>
                <p className="text-slate-800">{formatCurrency(charge.amountDue)} due · {formatCurrency(charge.amountPaid)} paid</p>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
