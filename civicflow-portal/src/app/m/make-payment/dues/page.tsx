import Link from "next/link";
import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { DuesCheckoutButton } from "@/components/app/DuesCheckoutButton";
import { filterPayableMethods, PayableMethodsList } from "@/components/app/PayableMethodsList";
import { getMemberWebSession } from "@/lib/member-web-session";
import { findActivePaymentLink } from "@/lib/payment-links";
import { derivePaymentNature, resolveCoverageDisplayPolicy } from "@/lib/payments/cost-policy";
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

  // COST-POLICY v2 (§8): dues are a FIXED OBLIGATION — the surface follows
  // the org's policy through the same resolver as the checkout route. With
  // v2 disabled this is FEE-COVER-C's optional offer, unchanged.
  const [paymentLink, paymentMethods, displayPolicy] = await Promise.all([
    findActivePaymentLink({ organizationId: memberSession.organizationId, linkType: "DUES" }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId: memberSession.organizationId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
    resolveCoverageDisplayPolicy({
      organizationId: memberSession.organizationId,
      nature: derivePaymentNature({ purpose: "member-dues" }),
    }),
  ]);

  const coverage = {
    offered: displayPolicy.display === "OPTIONAL",
    required: displayPolicy.display === "REQUIRED",
    percentBps: displayPolicy.percentBps,
    fixedCents: displayPolicy.fixedCents,
    fallbackMessage: displayPolicy.fallbackMessage,
    creditedNoticeLabel: displayPolicy.showCreditedNotice ? "Amount credited toward dues" : null,
  };

  const orgSuffix = org ? `?org=${encodeURIComponent(org)}` : "";

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">Pay Dues in Advance</h1>
      <p className="text-sm text-slate-600">
        Get ahead on your membership dues in any amount, even before your next charge is due.
      </p>

      {paymentLink ? (
        <DuesCheckoutButton
          organizationId={memberSession.organizationId}
          fixedAmount={paymentLink.amount ? Number(paymentLink.amount) : null}
          minAmount={paymentLink.minAmount ? Number(paymentLink.minAmount) : 1}
          coverage={coverage}
        />
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
