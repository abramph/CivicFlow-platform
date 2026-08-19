import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getTrialStatus } from "@/lib/plan-gate";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

async function TrialBanner({ organizationId }: { organizationId: string }) {
  const trial = await getTrialStatus(organizationId);
  if (!trial.isInTrial) return null;

  const isUrgent = trial.daysRemaining <= 7;

  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-2 text-sm ${isUrgent ? "bg-amber-500 text-white" : "bg-blue-600 text-white"}`}>
      <span>
        <span className="font-semibold">
          {trial.daysRemaining} day{trial.daysRemaining === 1 ? "" : "s"} left in your free trial.
        </span>
        {" "}You have full Essential access until your trial ends.
      </span>
      <Link
        href="/settings/billing"
        className={`shrink-0 rounded-md px-3 py-1 text-xs font-semibold ${isUrgent ? "bg-white text-amber-700 hover:bg-amber-50" : "bg-white text-blue-700 hover:bg-blue-50"}`}
      >
        Subscribe now
      </Link>
    </div>
  );
}

/**
 * Shown when a non-exempt organization's internal 30-day trial has ended
 * without a subscription. CLOUD-K: rewritten off the retired Essential/Elite
 * tier cards (which advertised obsolete prices and a "500 member" cap that
 * no longer exists anywhere). Unestra Cloud has exactly one plan per
 * vertical, priced per-vertical — so this wall doesn't repeat a pricing
 * table it can't know without the org's vertical; it sends the admin to
 * Billing, where their own vertical's real monthly/annual pricing renders
 * from the authoritative catalog. Nothing is deleted at expiration and no
 * card was ever collected during the trial, so no charge has occurred.
 */
function SubscriptionWall() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-16 text-center">
      <div className="mx-auto max-w-md">
        <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
          <span className="text-2xl">⏰</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-950">Your free trial has ended</h1>
        <p className="mt-3 text-slate-600">
          Subscribe to Unestra Cloud to continue. Your data is safe and waiting for you — nothing has
          been deleted, and you haven&apos;t been charged.
        </p>

        <div className="mt-8 rounded-xl border border-emerald-300 bg-emerald-50 p-5 text-left">
          <p className="font-bold text-slate-950">Unestra Cloud</p>
          <p className="mt-1 text-sm text-slate-600">One plan for your organization type, monthly or annual billing.</p>
          <ul className="mt-3 space-y-1.5 text-xs text-slate-600">
            <li>✓ Unlimited members</li>
            <li>✓ Administrative seats included</li>
            <li>✓ Email campaigns &amp; PDF export</li>
            <li>✓ Advanced reports &amp; API access</li>
          </ul>
        </div>

        <Link
          href="/settings/billing"
          className="mt-6 inline-block w-full rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          See your plan &amp; subscribe
        </Link>
        <p className="mt-3 text-xs text-slate-500">
          Questions? Email <a href="mailto:support@getunestra.com" className="underline">support@getunestra.com</a>
        </p>
      </div>
    </div>
  );
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const hasLegacySession = Boolean(session?.org_id && session?.api_key);
  const hasSaasSession = Boolean(session?.userId);

  if (!hasLegacySession && !hasSaasSession) {
    redirect("/login");
  }

  const organizationId = session?.organizationId ?? null;

  if (organizationId && hasSaasSession) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true, trialEndsAt: true, billingExempt: true },
    });

    const now = new Date();
    // Internal/platform-owned organizations (Organization.billingExempt)
    // are never subject to the trial-expiration wall — see plan-gate.ts.
    const trialExpired =
      !org?.billingExempt &&
      org?.plan === "free" &&
      (org.trialEndsAt === null || org.trialEndsAt <= now);

    if (trialExpired) {
      const hdrs = await headers();
      const pathname = hdrs.get("x-pathname") ?? "";
      const isBillingPage = pathname.startsWith("/settings/billing");
      if (!isBillingPage) {
        return <SubscriptionWall />;
      }
    }
  }

  return (
    <>
      {organizationId && hasSaasSession && <TrialBanner organizationId={organizationId} />}
      {children}
    </>
  );
}
