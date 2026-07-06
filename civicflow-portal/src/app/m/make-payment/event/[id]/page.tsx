import { notFound } from "next/navigation";
import Link from "next/link";
import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { filterPayableMethods, PayableMethodsList } from "@/components/app/PayableMethodsList";
import { formatDateTime } from "@/lib/formatting";
import { getMemberWebSession } from "@/lib/member-web-session";
import { findActivePaymentLink } from "@/lib/payment-links";
import { prisma } from "@/lib/prisma";

export default async function MemberPayEventPage({
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
        <OpenInAppBanner deepLink={`make-payment/event/${id}`} title="Pay for an Event" />
      </div>
    );
  }

  const event = await prisma.event.findFirst({
    where: { id, organizationId: memberSession.organizationId },
  });
  if (!event) notFound();

  const [paymentLink, paymentMethods] = await Promise.all([
    findActivePaymentLink({ organizationId: memberSession.organizationId, eventId: id }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId: memberSession.organizationId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
  ]);

  const orgSuffix = org ? `?org=${encodeURIComponent(org)}` : "";

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">{event.title}</h1>
      {event.description ? <p className="text-sm text-slate-700">{event.description}</p> : null}
      <p className="text-xs text-slate-500">
        {event.startAt ? formatDateTime(event.startAt) : "Date TBD"}
        {event.location ? ` · ${event.location}` : ""}
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
        href={`/m/report-payment?category=EVENT_REGISTRATION${org ? `&org=${encodeURIComponent(org)}` : ""}`}
        className="block rounded-lg border border-slate-300 px-4 py-3 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        Report a Payment for This Event
      </Link>

      <Link href={`/m/make-payment${orgSuffix}`} className="block text-center text-sm text-slate-500 hover:underline">
        ← Back to Make a Payment
      </Link>
    </main>
  );
}
