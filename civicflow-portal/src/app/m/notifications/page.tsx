import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { MemberNotificationSettingsForm } from "@/components/forms/MemberNotificationSettingsForm";
import { MemberWhatsAppSettingsForm } from "@/components/forms/MemberWhatsAppSettingsForm";
import { formatSmsOptInMethod } from "@/lib/sms-consent-text";
import { getMemberWebSession } from "@/lib/member-web-session";
import { prisma } from "@/lib/prisma";

export default async function MemberNotificationsPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="notifications" title="Notification Settings" />
      </div>
    );
  }

  const member = await prisma.orgMember.findUnique({
    where: { id: memberSession.memberId },
    select: {
      phone: true,
      smsOptIn: true,
      smsOptInDate: true,
      smsOptInMethod: true,
      smsOptOutDate: true,
      commsSmsEnabled: true,
      smsOptedOutAt: true,
      whatsappPhoneNumber: true,
      whatsappOptInStatus: true,
      whatsappOptedInAt: true,
      whatsappOptedOutAt: true,
      whatsappEnabled: true,
    },
  });

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">Notification Settings</h1>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">SMS</h2>
        <MemberNotificationSettingsForm
          organizationId={memberSession.organizationId}
          phone={member?.phone ?? null}
          smsOptIn={member?.smsOptIn ?? false}
          smsOptInDate={member?.smsOptInDate?.toISOString() ?? null}
          smsOptInMethodLabel={formatSmsOptInMethod(member?.smsOptInMethod)}
          smsOptOutDate={member?.smsOptOutDate?.toISOString() ?? null}
          commsSmsEnabled={member?.commsSmsEnabled ?? false}
          hardStopBlocked={Boolean(member?.smsOptedOutAt)}
        />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">WhatsApp</h2>
        <MemberWhatsAppSettingsForm
          organizationId={memberSession.organizationId}
          whatsappPhoneNumber={member?.whatsappPhoneNumber ?? null}
          whatsappOptInStatus={member?.whatsappOptInStatus ?? "NOT_STARTED"}
          whatsappOptedInAt={member?.whatsappOptedInAt?.toISOString() ?? null}
          whatsappOptedOutAt={member?.whatsappOptedOutAt?.toISOString() ?? null}
          whatsappEnabled={member?.whatsappEnabled ?? false}
        />
      </div>
    </main>
  );
}
