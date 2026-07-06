import Link from "next/link";
import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { formatDateTime } from "@/lib/formatting";
import { getMemberWebSession } from "@/lib/member-web-session";
import { prisma } from "@/lib/prisma";

export default async function MemberInboxPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="inbox" title="Inbox" />
      </div>
    );
  }

  const participations = await prisma.conversationParticipant.findMany({
    where: { userId: memberSession.userId, organizationId: memberSession.organizationId },
    include: {
      conversation: {
        include: {
          participants: {
            where: { userId: { not: memberSession.userId } },
            include: { user: { select: { id: true, displayName: true, email: true } } },
          },
        },
      },
    },
    orderBy: { conversation: { lastMessageAt: "desc" } },
    take: 100,
  });

  const conversations = participations
    .filter((participation) => participation.conversation)
    .map((participation) => {
      const conversation = participation.conversation;
      const hasUnread = Boolean(
        conversation.lastMessageAt && (!participation.lastReadAt || conversation.lastMessageAt > participation.lastReadAt)
      );
      const otherNames = conversation.participants.map((p) => p.user.displayName ?? p.user.email).join(", ");
      return {
        id: conversation.id,
        subject: conversation.subject,
        lastMessageAt: conversation.lastMessageAt,
        hasUnread,
        otherNames,
      };
    });

  const orgSuffix = org ? `?org=${encodeURIComponent(org)}` : "";

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">Inbox</h1>
      <div className="space-y-3">
        {conversations.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-600">
            No conversations yet.
          </p>
        ) : (
          conversations.map((conversation) => (
            <Link
              key={conversation.id}
              href={`/m/inbox/${conversation.id}${orgSuffix}`}
              className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-emerald-300"
            >
              <div className="flex items-center justify-between gap-2">
                <p className={`truncate ${conversation.hasUnread ? "font-semibold text-slate-900" : "text-slate-700"}`}>
                  {conversation.subject || conversation.otherNames || "Officers"}
                </p>
                {conversation.hasUnread ? <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-600" /> : null}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {conversation.otherNames}
                {conversation.lastMessageAt ? ` · ${formatDateTime(conversation.lastMessageAt)}` : ""}
              </p>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
