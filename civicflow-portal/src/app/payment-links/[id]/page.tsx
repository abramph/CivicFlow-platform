import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatCurrency, formatDate, formatEnumLabel } from "@/lib/formatting";
import { prisma } from "@/lib/prisma";
import { getServerEnv } from "@/lib/env";

export default async function PaymentLinkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organizationId } = await requirePermission("contributions:read");
  const { id } = await params;
  const env = getServerEnv();
  const baseUrl = env.NEXTAUTH_URL.replace(/\/$/, "");

  const link = await prisma.paymentLink.findFirst({
    where: { id, organizationId },
    include: {
      campaign: { select: { id: true, name: true } },
      event: { select: { id: true, title: true } },
    },
  });

  if (!link) notFound();

  const publicUrl = `${baseUrl}/pay/${link.slug}`;

  return (
    <main className="space-y-6">
      <PageHeader
        title={link.title}
        description={link.description ?? "Payment link details and sharing URL."}
        actions={[
          { href: `/payment-links/${link.id}/edit`, label: "Edit", tone: "primary" },
          { href: "/payment-links", label: "Back to Payment Links" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Status" value={formatEnumLabel(link.status)} />
        <StatCard label="Type" value={formatEnumLabel(link.linkType)} />
        <StatCard label="Amount" value={link.amount ? formatCurrency(link.amount) : "Flexible"} />
        <StatCard label="Total Uses" value={link.useCount} />
      </div>

      <SectionCard title="Share this link" description="Anyone with this URL can pay without logging in.">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <code className="flex-1 break-all rounded-lg bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-200">
            {publicUrl}
          </code>
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
          >
            Open
          </a>
        </div>
        {link.status !== "active" && (
          <p className="mt-3 text-sm text-yellow-700">
            This link is {link.status} — payers will see a "not available" message.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Details">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {link.campaign && (
            <>
              <dt className="text-sm font-medium text-slate-700">Campaign</dt>
              <dd className="text-sm text-slate-900">
                <Link href={`/campaigns/${link.campaign.id}`} className="text-emerald-700 hover:underline">
                  {link.campaign.name}
                </Link>
              </dd>
            </>
          )}
          {link.event && (
            <>
              <dt className="text-sm font-medium text-slate-700">Event</dt>
              <dd className="text-sm text-slate-900">
                <Link href={`/events/${link.event.id}`} className="text-emerald-700 hover:underline">
                  {link.event.title}
                </Link>
              </dd>
            </>
          )}
          {link.minAmount && (
            <>
              <dt className="text-sm font-medium text-slate-700">Minimum amount</dt>
              <dd className="text-sm text-slate-900">{formatCurrency(link.minAmount)}</dd>
            </>
          )}
          {link.expiresAt && (
            <>
              <dt className="text-sm font-medium text-slate-700">Expires</dt>
              <dd className="text-sm text-slate-900">{formatDate(link.expiresAt)}</dd>
            </>
          )}
          <dt className="text-sm font-medium text-slate-700">Created</dt>
          <dd className="text-sm text-slate-900">{formatDate(link.createdAt)}</dd>
        </dl>
      </SectionCard>
    </main>
  );
}
