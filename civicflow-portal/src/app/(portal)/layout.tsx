import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getTrialStatus } from "@/lib/plan-gate";
import { resolveOrganizationAccess } from "@/lib/subscription-gate";
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

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const hasLegacySession = Boolean(session?.org_id && session?.api_key);
  const hasSaasSession = Boolean(session?.userId);

  if (!hasLegacySession && !hasSaasSession) {
    redirect("/login");
  }

  const organizationId = session?.organizationId ?? null;

  // LAUNCH-BLOCKER subscription gate: dashboard/analytics/payments (this
  // route group) read the session directly rather than calling
  // requireOrganization()/requirePermission(), so they don't get the gate
  // that auth-guards.ts applies everywhere else — this is their only
  // enforcement point. Always resolve through the same canonical
  // resolveOrganizationAccess() every other chokepoint uses; never re-derive
  // trial/subscription state independently here.
  if (organizationId && hasSaasSession) {
    const hdrs = await headers();
    const pathname = hdrs.get("x-pathname") ?? "";
    // Recovery-path allowlist: billing settings must stay reachable even
    // when access is denied — it's how an owner restores it.
    const isBillingPage = pathname.startsWith("/settings/billing");
    if (!isBillingPage) {
      const access = await resolveOrganizationAccess(organizationId);
      if (!access.allowed) {
        redirect("/subscription-required");
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
