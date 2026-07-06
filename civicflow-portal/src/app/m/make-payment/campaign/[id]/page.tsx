import { notFound } from "next/navigation";
import Link from "next/link";
import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { filterPayableMethods, PayableMethodsList } from "@/components/app/PayableMethodsList";
import { formatCurrency, formatDate } from "@/lib/formatting";
import { getMemberWebSession } from "@/lib/member-web-session";
import { findActivePaymentLink } from "@/lib/payment-links";
import { prisma } from "@/lib/prisma";

export default async function MemberPayCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { id } = await params;
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink={`make-payment/campaign/${id}`} title="Contribute to a Campaign" />
      </div>
    );
  }

  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId: memberSession.organizationId },
  });
  if (!campaign) notFound();

  const [paymentLink, paymentMethods] = await Promise.all([
    findActivePaymentLink({ organizationId: memberSession.organizationId, campaignId: id }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId: memberSession.organizationId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
  ]);

  const orgSuffix = org ? `?org=${encodeURIComponent(org)}` : "";

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">{campaign.name}</h1>
      {campaign.description ? <p className="text-sm text-slate-700">{campaign.description}</p> : null}
      {campaign.goal ? <p className="text-sm text-slate-600">Goal: {formatCurrency(campaign.goal)}</p> : null}
      {campaign.endDate ? <p className="text-xs text-slate-500">Ends {formatDate(campaign.endDate)}</p> : null}

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
        href={`/m/report-payment?category=DONATION${org ? `&org=${encodeURIComponent(org)}` : ""}`}
        className="block rounded-lg border border-slate-300 px-4 py-3 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        Report a Payment for This Campaign
      </Link>

      <Link href={`/m/make-payment${orgSuffix}`} className="block text-center text-sm text-slate-500 hover:underline">
        ← Back to Make a Payment
      </Link>
    </main>
  );
}
