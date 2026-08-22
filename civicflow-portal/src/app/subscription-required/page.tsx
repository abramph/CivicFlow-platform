import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { resolveOrganizationAccess } from "@/lib/subscription-gate";
import { resolvePricingVertical } from "@/lib/plans";
import { BillingPlans } from "@/components/app/BillingPlans";
import { LogoutButton } from "@/components/LogoutButton";
import { SUPPORT_EMAIL } from "@/lib/brand";

/**
 * LAUNCH-BLOCKER: the redirect target requireOrganization() sends every
 * gated page/route to once resolveOrganizationAccess() denies access (see
 * auth-guards.ts). Must itself skip the gate — it IS the page an
 * already-denied session lands on, so re-checking it here would infinite-
 * loop the redirect.
 *
 * Deliberately a single page for both owners and everyone else, branching
 * on role, rather than two separate routes — keeps the "what does a denied
 * session see" decision in one place instead of duplicating the
 * billing-permission check across two pages.
 */
export default async function SubscriptionRequiredPage() {
  const { organizationId, can } = await requirePermission("billing:read", "redirect", { skipEntitlementGate: true });

  const [access, organization] = await Promise.all([
    resolveOrganizationAccess(organizationId),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, primaryVertical: true, plan: true },
    }),
  ]);

  // Defensive: a session that lands here but is actually allowed (e.g. the
  // owner just completed checkout and the webhook already restored access)
  // belongs back on the dashboard, not stuck looking at a stale wall.
  if (access.allowed || !organization) {
    redirect("/dashboard");
  }

  const canManageBilling = can("billing:manage");
  const pricingVertical = resolvePricingVertical(organization.primaryVertical);

  return (
    <main className="flex min-h-screen flex-col items-center bg-slate-50 px-6 py-16">
      <div className="mx-auto w-full max-w-2xl text-center">
        <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
          <span className="text-2xl">⏰</span>
        </div>

        {canManageBilling ? (
          <>
            <h1 className="text-2xl font-bold text-slate-950">Your Unestra trial has ended</h1>
            <p className="mt-3 text-slate-600">
              Choose a plan to restore access to your organization&apos;s workspace. Your organization&apos;s
              data remains preserved and will become available again after your subscription is active.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-slate-950">This organization&apos;s Unestra access is currently inactive</h1>
            <p className="mt-3 text-slate-600">Please contact an organization administrator for assistance.</p>
          </>
        )}
      </div>

      {canManageBilling ? (
        <div className="mt-10 w-full max-w-3xl text-left">
          <BillingPlans
            vertical={pricingVertical}
            currentPlanId={organization.plan}
            isInTrial={false}
            hasActiveSubscription={false}
            canManageBilling={canManageBilling}
          />
          <p className="mt-6 text-center text-sm text-slate-600">
            Questions about billing?{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-emerald-700 hover:underline">
              Contact Unestra Support
            </a>
          </p>
        </div>
      ) : null}

      <div className="mt-10 flex items-center gap-4">
        <LogoutButton />
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sm text-slate-600 hover:underline">
          Contact Support
        </a>
      </div>
    </main>
  );
}
