import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { formatDateTime } from "@/lib/formatting";
import { getMemberWebSession } from "@/lib/member-web-session";
import { prisma } from "@/lib/prisma";

export default async function MemberAnnouncementsPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="announcements" title="Announcements" />
      </div>
    );
  }

  const recipients = await prisma.communicationRecipient.findMany({
    where: {
      organizationId: memberSession.organizationId,
      memberId: memberSession.memberId,
      deliveryStatus: { in: ["SENT", "SKIPPED"] },
      campaign: { communicationType: { in: ["ANNOUNCEMENT", "GENERAL"] }, status: "SENT" },
    },
    orderBy: { sentAt: "desc" },
    include: { campaign: { select: { id: true, subject: true, title: true, body: true, sentAt: true } } },
    take: 50,
  });

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">Announcements</h1>
      <div className="space-y-3">
        {recipients.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-600">No announcements yet.</p>
        ) : (
          recipients.map((recipient) => (
            <div key={recipient.campaign.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="font-semibold text-slate-900">{recipient.campaign.subject || recipient.campaign.title}</p>
              {recipient.campaign.sentAt ? <p className="text-xs text-slate-500">{formatDateTime(recipient.campaign.sentAt)}</p> : null}
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{recipient.campaign.body}</p>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
