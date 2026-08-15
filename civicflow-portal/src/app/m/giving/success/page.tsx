import Link from "next/link";
import { getMemberWebSession } from "@/lib/member-web-session";
import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { getStripe } from "@/lib/stripe";
import { getStripeForMode } from "@/lib/payments/stripe-connect";
import { prisma } from "@/lib/prisma";

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * CORE-GIVE-B — post-checkout landing. Confirmation is SERVER-SIDE (§7): we
 * retrieve the session from Stripe and look for the webhook-recorded
 * contribution. The redirect itself proves nothing and records nothing.
 */
export default async function GivingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; org?: string; recurring?: string }>;
}) {
  const { session_id, org, recurring } = await searchParams;
  const memberSession = await getMemberWebSession(org);
  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="giving" title="Giving" />
      </div>
    );
  }

  const backHref = `/m/giving?org=${encodeURIComponent(memberSession.organizationId)}`;
  let state: "PAID_RECORDED" | "PAID_PROCESSING" | "NOT_PAID" | "UNKNOWN" = "UNKNOWN";
  let recorded: { contributionNumber: string | null; amount: number; fundName: string | null } | null = null;

  if (session_id) {
    try {
      // CONNECT-I: the checkout session was created on the org's CONNECTED
      // account (once connected) — retrieving it with the platform client
      // always 404s cross-account, landing every real gift in the UNKNOWN
      // "could not confirm" state even though the webhook recorded it fine.
      const accountRow = await prisma.organizationStripeAccount.findUnique({
        where: { organizationId: memberSession.organizationId },
        select: { stripeAccountId: true, accountMode: true, chargesEnabled: true, disabledAt: true },
      });
      const stripeAccountOptions =
        accountRow?.chargesEnabled && !accountRow.disabledAt ? { stripeAccount: accountRow.stripeAccountId } : undefined;
      const stripe = stripeAccountOptions ? await getStripeForMode(accountRow!.accountMode as "test" | "live") : getStripe();
      const session = await stripe.checkout.sessions.retrieve(session_id, {}, stripeAccountOptions);
      // Tenant check: only sessions this member's org initiated are shown.
      if (
        recurring === "1" &&
        session.metadata?.organizationId === memberSession.organizationId &&
        session.metadata?.paymentType === "giving-recurring"
      ) {
        // Recurring setup: show the schedule state (the first invoice may
        // still be settling — that is fine and said plainly).
        const schedule = session.metadata?.scheduleId
          ? await prisma.recurringContributionSchedule.findFirst({
              where: { id: session.metadata.scheduleId, organizationId: memberSession.organizationId },
              include: { fund: { select: { name: true } } },
            })
          : null;
        if (schedule && schedule.status !== "PENDING_SETUP") {
          state = "PAID_RECORDED";
          recorded = { contributionNumber: null, amount: Number(schedule.amount), fundName: schedule.fund.name };
        } else if (schedule) {
          state = "PAID_PROCESSING";
        }
      } else if (session.metadata?.organizationId === memberSession.organizationId && session.metadata?.paymentType === "giving") {
        if (session.payment_status === "paid") {
          const reference =
            typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? session.id);
          const contribution = await prisma.contribution.findFirst({
            where: { organizationId: memberSession.organizationId, providerPaymentIntentId: reference },
            select: { contributionNumber: true, amount: true, fund: { select: { name: true } } },
          });
          if (contribution) {
            state = "PAID_RECORDED";
            recorded = {
              contributionNumber: contribution.contributionNumber,
              amount: Number(contribution.amount),
              fundName: contribution.fund?.name ?? null,
            };
          } else {
            state = "PAID_PROCESSING";
          }
        } else {
          state = "NOT_PAID";
        }
      }
    } catch {
      state = "UNKNOWN";
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      {state === "PAID_RECORDED" && recorded ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <h1 className="text-2xl font-bold text-emerald-900">Thank you!</h1>
          <p className="mt-2 text-emerald-900">
            {recurring === "1"
              ? `Your recurring ${money(recorded.amount)} contribution${recorded.fundName ? ` to ${recorded.fundName}` : ""} is set up. You can change, pause, or cancel it any time.`
              : `Your ${money(recorded.amount)} contribution${recorded.fundName ? ` to ${recorded.fundName}` : ""} was received.`}
          </p>
          {recorded.contributionNumber ? (
            <p className="mt-1 font-mono text-sm text-emerald-700">{recorded.contributionNumber}</p>
          ) : null}
        </div>
      ) : state === "PAID_PROCESSING" ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-6 text-center">
          <h1 className="text-2xl font-bold text-sky-900">Payment received</h1>
          <p className="mt-2 text-sky-900">
            Your payment succeeded and your contribution record is being finalized — it will appear in your history in a
            moment. Refresh this page to see it.
          </p>
        </div>
      ) : state === "NOT_PAID" ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
          <h1 className="text-2xl font-bold text-amber-900">Payment not completed</h1>
          <p className="mt-2 text-amber-900">This checkout was not completed. No contribution was recorded.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Giving</h1>
          <p className="mt-2 text-slate-600">We could not confirm this checkout session.</p>
        </div>
      )}
      <div className="text-center">
        <Link href={backHref} className="text-sm font-semibold text-emerald-700 hover:underline">
          ← Back to Giving
        </Link>
      </div>
    </main>
  );
}
