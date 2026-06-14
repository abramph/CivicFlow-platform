import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { OrganizationOnboardingForm } from "@/components/forms/OrganizationOnboardingForm";

export default async function OnboardingOrganizationPage() {
  const session = await getServerSession(authOptions);

  if (!session?.userId) {
    redirect("/login");
  }

  if (session.organizationId) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen bg-slate-100 px-6 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
            CivicFlow Onboarding
          </p>
          <h1 className="text-3xl font-semibold text-slate-950">Set up your organization</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-700">
            Create the organization profile, seed default membership and dues categories,
            and get the SaaS portal ready for member, contribution, and dues workflows.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-300 bg-white p-6 shadow-sm">
          <OrganizationOnboardingForm />
        </div>
      </div>
    </main>
  );
}
