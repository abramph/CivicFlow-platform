import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { MemberReportPaymentForm } from "@/components/forms/MemberReportPaymentForm";
import { getMemberWebSession } from "@/lib/member-web-session";

export default async function MemberReportPaymentPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="report-payment" title="Report a Payment" />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">Report a Payment</h1>
      {memberSession.organizations.length > 1 ? (
        <p className="text-sm text-slate-600">
          Reporting for {memberSession.organizations.find((o) => o.organizationId === memberSession.organizationId)?.organizationName}.
        </p>
      ) : null}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <MemberReportPaymentForm organizationId={memberSession.organizationId} />
      </div>
    </main>
  );
}
