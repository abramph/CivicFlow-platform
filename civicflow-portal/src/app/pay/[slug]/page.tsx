import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PublicPaymentForm } from "@/components/public/PublicPaymentForm";
import { derivePaymentNature, resolveCoverageDisplayPolicy } from "@/lib/payments/cost-policy";

export default async function PublicPayPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const link = await prisma.paymentLink.findUnique({
    where: { slug },
    include: {
      organization: { select: { name: true, logoUrl: true } },
      campaign: { select: { name: true } },
      event: { select: { title: true } },
      methods: {
        where: { paymentMethodConfig: { isActive: true } },
        include: { paymentMethodConfig: true },
        orderBy: { paymentMethodConfig: { sortOrder: "asc" } },
      },
    },
  });

  if (!link || link.status === "archived") notFound();

  // COST-POLICY v2 (§8): what this checkout surface renders follows the
  // link's NATURE (campaign = voluntary, event = fixed purchase, dues =
  // fixed obligation) through the org's policy. With v2 disabled this is
  // FEE-COVER-C's optional offer, unchanged. Rates feed the live estimate
  // only; the checkout route re-resolves authoritatively server-side.
  const nature = derivePaymentNature({
    purpose: link.campaign ? "payment-link-campaign" : link.event ? "payment-link-event" : "payment-link-dues",
  });
  const displayPolicy = await resolveCoverageDisplayPolicy({ organizationId: link.organizationId, nature });
  const coverage = {
    offered: displayPolicy.display === "OPTIONAL",
    required: displayPolicy.display === "REQUIRED",
    percentBps: displayPolicy.percentBps,
    fixedCents: displayPolicy.fixedCents,
    fallbackMessage: displayPolicy.fallbackMessage,
    creditedNoticeLabel: displayPolicy.showCreditedNotice
      ? link.event
        ? "Amount credited toward your registration"
        : "Amount credited toward dues"
      : null,
  };

  const methods = link.methods.map((m) => ({
    id: m.paymentMethodConfig.id,
    method: m.paymentMethodConfig.method,
    label: m.paymentMethodConfig.label,
    instructions: m.paymentMethodConfig.instructions,
    accountIdentifier: m.paymentMethodConfig.accountIdentifier,
  }));

  const expired = link.expiresAt && link.expiresAt < new Date();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <p className="text-sm font-medium text-slate-500">{link.organization.name}</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">{link.title}</h1>
          {(link.campaign?.name ?? link.event?.title) && (
            <p className="mt-1 text-sm text-slate-600">
              {link.campaign?.name ?? link.event?.title}
            </p>
          )}
          {link.description && (
            <p className="mt-3 text-sm leading-6 text-slate-700">{link.description}</p>
          )}
        </div>

        {link.status === "inactive" || expired ? (
          <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-6 text-center text-sm text-yellow-800">
            {expired ? "This payment link has expired." : "This payment link is not currently active."}
          </div>
        ) : (
          <PublicPaymentForm
            slug={slug}
            fixedAmount={link.amount ? Number(link.amount) : null}
            minAmount={link.minAmount ? Number(link.minAmount) : 1}
            methods={methods}
            coverage={coverage}
          />
        )}

        <p className="mt-6 text-center text-xs text-slate-400">
          {methods.length > 0 ? "Choose how you'd like to pay above." : "This link has no active payment methods configured."}
        </p>
      </div>
    </div>
  );
}
