import Link from "next/link";
import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { getMemberWebSession } from "@/lib/member-web-session";
import { UnionCaseIntakeForm } from "@/components/union/UnionCaseIntakeForm";

export default async function NewUnionCasePage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="union-cases" title="Get help" />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Get help</h1>
        <p className="mt-1 text-sm text-slate-600">
          Tell us what&apos;s going on and a steward or representative from {memberSession.organizationName} will follow up. This
          doesn&apos;t file a formal grievance on its own -- it just gets your issue in front of someone who can help.
        </p>
      </div>

      <UnionCaseIntakeForm organizationId={memberSession.organizationId} />

      <p className="text-sm">
        <Link href="/m/union/cases" className="font-semibold text-emerald-700 hover:underline">
          ← Back to My Cases
        </Link>
      </p>
    </main>
  );
}
