import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth-guards";
import { getUserOrgMemberships } from "@/lib/org-context";
import { OrganizationPicker } from "./OrganizationPicker";

/**
 * Post-login landing page for staff+member accounts. Only requires auth
 * (not an active org) since its whole job is picking one. A single active
 * membership always resolves the same way via resolveActiveOrganization's
 * "oldest membership" fallback, so it's safe to redirect straight through
 * without writing a cookie here.
 */
export default async function SelectOrganizationPage() {
  const session = await requireAuth();
  const memberships = await getUserOrgMemberships(session.userId);

  if (memberships.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xl">
            🏢
          </div>
          <h1 className="text-lg font-bold text-slate-900">You don&apos;t belong to any organization yet</h1>
          <p className="mt-2 text-sm text-slate-600">
            Contact your organization to be added as a member or staff user, or create a new organization of your own.
          </p>
          <Link
            href="/onboarding/organization"
            className="mt-5 block w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Create a new organization
          </Link>
        </div>
      </div>
    );
  }

  if (memberships.length === 1) {
    const only = memberships[0];
    redirect(only.role === "MEMBER" ? (only.memberId ? "/m/dues" : "/m/my-household") : "/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5">
          <h1 className="text-lg font-bold text-slate-900">Choose an organization</h1>
          <p className="mt-1 text-sm text-slate-600">You belong to more than one organization. Pick one to continue.</p>
        </div>
        <OrganizationPicker memberships={memberships} />
      </div>
    </div>
  );
}
