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

function SubscriptionWall() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-16 text-center">
      <div className="mx-auto max-w-md">
        <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
          <span className="text-2xl">⏰</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-950">Your free trial has ended</h1>
        <p className="mt-3 text-slate-600">
          Subscribe to Essential or Elite to continue using Unestra. Your data is safe and waiting for you.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-left">
            <p className="font-bold text-slate-950">Essential</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">$49<span className="text-sm font-normal text-slate-500">/mo</span></p>
            <ul className="mt-3 space-y-1.5 text-xs text-slate-600">
              <li>✓ Up to 500 members</li>
              <li>✓ Email campaigns</li>
              <li>✓ PDF export</li>
              <li>✓ Payment reconciliation</li>
            </ul>
          </div>
          <div className="rounded-xl border border-emerald-400 bg-emerald-50 p-5 text-left">
            <p className="font-bold text-slate-950">Elite</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">$99<span className="text-sm font-normal text-slate-500">/mo</span></p>
            <ul className="mt-3 space-y-1.5 text-xs text-slate-600">
              <li>✓ Unlimited members</li>
              <li>✓ Advanced reports</li>
              <li>✓ API access</li>
              <li>✓ Priority support</li>
            </ul>
          </div>
        </div>

        <Link
          href="/settings/billing"
          className="mt-6 inline-block w-full rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Choose a plan
        </Link>
        <p className="mt-3 text-xs text-slate-500">
          Questions? Email <a href="mailto:support@civicflowapp.com" className="underline">support@civicflowapp.com</a>
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
      select: { plan: true, trialEndsAt: true },
    });

    const now = new Date();
    const trialExpired =
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
