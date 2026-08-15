import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { getStripeForMode } from "@/lib/payments/stripe-connect";

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * CORE-GIVE-J — public post-checkout landing. Confirmation is SERVER-SIDE:
 * the Stripe session's metadata organization must match the slug's
 * organization or nothing is shown. The redirect records nothing (§7);
 * the webhook is the only recorder.
 */
export default async function PublicGiveSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { slug } = await params;
  const { session_id } = await searchParams;
  const organization = await prisma.organization.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!organization) notFound();

  let state: "PAID" | "PROCESSING" | "UNKNOWN" = "UNKNOWN";
  let amount: number | null = null;
  if (session_id) {
    try {
      // CONNECT-I: the checkout session was created on the org's CONNECTED
      // account (once connected) — retrieving it with the platform client
      // always 404s cross-account, landing every real gift in the UNKNOWN
      // "could not confirm" state even though the webhook recorded it fine.
      const accountRow = await prisma.organizationStripeAccount.findUnique({
        where: { organizationId: organization.id },
        select: { stripeAccountId: true, accountMode: true, chargesEnabled: true, disabledAt: true },
      });
      const stripeAccountOptions =
        accountRow?.chargesEnabled && !accountRow.disabledAt ? { stripeAccount: accountRow.stripeAccountId } : undefined;
      const stripe = stripeAccountOptions ? await getStripeForMode(accountRow!.accountMode as "test" | "live") : getStripe();
      const session = await stripe.checkout.sessions.retrieve(session_id, {}, stripeAccountOptions);
      if (session.metadata?.organizationId === organization.id && session.metadata?.paymentType === "public-giving") {
        if (session.payment_status === "paid") {
          state = "PAID";
          amount = (session.amount_total ?? 0) / 100;
        } else {
          state = "PROCESSING";
        }
      }
    } catch {
      state = "UNKNOWN";
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        {state === "PAID" ? (
          <>
            <h1 className="text-xl font-bold text-slate-900">Thank you</h1>
            <p className="mt-2 text-sm text-slate-700">
              Your gift{amount ? ` of ${money(amount)}` : ""} to {organization.name} was received.
              {" "}A receipt will be available from the organization; if you provided an email, Stripe also sends a payment
              confirmation.
            </p>
          </>
        ) : state === "PROCESSING" ? (
          <>
            <h1 className="text-xl font-bold text-slate-900">Payment processing</h1>
            <p className="mt-2 text-sm text-slate-700">
              Your payment to {organization.name} has not finished processing yet. If it completes, the organization will
              have the record — nothing further is needed from you.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-slate-900">Giving</h1>
            <p className="mt-2 text-sm text-slate-700">We could not confirm a payment from this link.</p>
          </>
        )}
        <div className="mt-5 space-y-2">
          <Link
            href={`/give/${encodeURIComponent(slug)}`}
            className="block w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
          >
            Back to giving page
          </Link>
          <p className="text-xs text-slate-500">
            Want to manage your giving, set up recurring gifts, and download statements?{" "}
            <Link href="/signup" className="font-semibold text-emerald-700 hover:underline">
              Create a free account
            </Link>
            {" "}— entirely optional.
          </p>
        </div>
      </div>
    </div>
  );
}
