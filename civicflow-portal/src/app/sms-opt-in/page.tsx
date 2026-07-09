import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { MemberNotificationSettingsForm } from "@/components/forms/MemberNotificationSettingsForm";
import { getMemberWebSession } from "@/lib/member-web-session";
import { formatSmsOptInMethod } from "@/lib/sms-consent-text";
import { prisma } from "@/lib/prisma";

const BENEFITS = [
  "Get payment and dues confirmations the moment they happen.",
  "Never miss an event, meeting, or volunteer opportunity.",
  "Hear about organization announcements right away.",
  "Reply STOP anytime to opt out — no strings attached.",
];

export default async function SmsOptInPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const session = await getServerSession(authOptions);
  const memberSession = await getMemberWebSession(org);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Stay Connected by Text</h1>
          <p className="text-sm text-slate-600">Turn on SMS notifications from CivicFlow and your organization.</p>
        </div>

        <ul className="space-y-2 text-sm text-slate-700">
          {BENEFITS.map((benefit) => (
            <li key={benefit} className="flex items-start gap-2">
              <span className="mt-0.5 text-emerald-600">✓</span>
              <span>{benefit}</span>
            </li>
          ))}
        </ul>

        <div className="border-t border-slate-200 pt-6">
          {!session?.userId ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">Sign in to your CivicFlow account to turn on SMS notifications.</p>
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(org ? `/sms-opt-in?org=${org}` : "/sms-opt-in")}`}
                className="block w-full rounded-lg bg-emerald-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Sign In
              </Link>
              <Link
                href="/signup"
                className="block w-full rounded-lg border border-slate-300 px-4 py-2 text-center text-sm font-semibold text-slate-900 hover:bg-slate-50"
              >
                Create an Account
              </Link>
            </div>
          ) : memberSession ? (
            <MemberSmsOptInSection organizationId={memberSession.organizationId} memberId={memberSession.memberId} />
          ) : (
            <div className="space-y-2 text-sm text-slate-600">
              <p>We couldn&apos;t find a membership on file for your account.</p>
              <p>Contact your organization to be added as a member, or check your account&apos;s Notification Settings if you manage SMS preferences elsewhere.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

async function MemberSmsOptInSection({ organizationId, memberId }: { organizationId: string; memberId: string }) {
  const member = await prisma.orgMember.findUnique({
    where: { id: memberId },
    select: {
      phone: true,
      smsOptIn: true,
      smsOptInDate: true,
      smsOptInMethod: true,
      smsOptOutDate: true,
      commsSmsEnabled: true,
      smsOptedOutAt: true,
    },
  });

  return (
    <MemberNotificationSettingsForm
      organizationId={organizationId}
      phone={member?.phone ?? null}
      smsOptIn={member?.smsOptIn ?? false}
      smsOptInDate={member?.smsOptInDate?.toISOString() ?? null}
      smsOptInMethodLabel={formatSmsOptInMethod(member?.smsOptInMethod)}
      smsOptOutDate={member?.smsOptOutDate?.toISOString() ?? null}
      commsSmsEnabled={member?.commsSmsEnabled ?? false}
      hardStopBlocked={Boolean(member?.smsOptedOutAt)}
      consentMethod="QR_CODE"
    />
  );
}
