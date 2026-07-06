import Link from "next/link";
import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { filterPayableMethods, PayableMethodsList } from "@/components/app/PayableMethodsList";
import { getMemberWebSession } from "@/lib/member-web-session";
import { findActivePaymentLink } from "@/lib/payment-links";
import { prisma } from "@/lib/prisma";

export default async function MemberPayDuesInAdvancePage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="make-payment/dues" title="Pay Dues in Advance" />
      </div>
    );
  }

  const [paymentLink, paymentMethods] = await Promise.all([
    findActivePaymentLink({ organizationId: memberSession.organizationId, linkType: "DUES" }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId: memberSession.organizationId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
  ]);

  const orgSuffix = org ? `?org=${encodeURIComponent(org)}` : "";

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">Pay Dues in Advance</h1>
      <p className="text-sm text-slate-600">
        Get ahead on your membership dues in any amount, even before your next charge is due.
      </p>

      {paymentLink ? (
        <a
          href={`/pay/${paymentLink.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg bg-emerald-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Pay Now via Card
        </a>
      ) : null}

      <PayableMethodsList methods={filterPayableMethods(paymentMethods)} />

      <Link
        href={`/m/report-payment?category=MEMBERSHIP_DUES${org ? `&org=${encodeURIComponent(org)}` : ""}`}
        className="block rounded-lg border border-slate-300 px-4 py-3 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        Report a Payment
      </Link>

      <Link href={`/m/make-payment${orgSuffix}`} className="block text-center text-sm text-slate-500 hover:underline">
        ← Back to Make a Payment
      </Link>
    </main>
  );
}
