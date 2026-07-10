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
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
            Unestra
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">
            Welcome — let&apos;s set up your organization.
          </h1>
        </div>

        <div className="rounded-2xl border border-slate-300 bg-white p-6 shadow-sm">
          <OrganizationOnboardingForm />
        </div>
      </div>
    </main>
  );
}
