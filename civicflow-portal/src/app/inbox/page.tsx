import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { InboxList, type InboxConversation } from "@/components/app/InboxList";
import { NewConversationForm } from "@/components/forms/NewConversationForm";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, organizationId, can } = await requirePermission("messages:read");
  const resolvedSearchParams = await searchParams;
  const composeMemberId = typeof resolvedSearchParams.composeMemberId === "string" ? resolvedSearchParams.composeMemberId : null;
  const composeMemberName = typeof resolvedSearchParams.composeMemberName === "string" ? resolvedSearchParams.composeMemberName : "";

  const participations = await prisma.conversationParticipant.findMany({
    where: { userId: session.userId, organizationId },
    include: {
      conversation: {
        include: {
          participants: {
            where: { userId: { not: session.userId } },
            include: { user: { select: { id: true, displayName: true, email: true } } },
          },
        },
      },
    },
    orderBy: { conversation: { lastMessageAt: "desc" } },
    take: 100,
  });

  const conversations: InboxConversation[] = participations
    .filter((participation) => participation.conversation)
    .map((participation) => {
      const conversation = participation.conversation;
      const hasUnread = Boolean(
        conversation.lastMessageAt && (!participation.lastReadAt || conversation.lastMessageAt > participation.lastReadAt)
      );
      return {
        id: conversation.id,
        subject: conversation.subject,
        channel: conversation.channel,
        lastMessageAt: conversation.lastMessageAt ? conversation.lastMessageAt.toISOString() : null,
        hasUnread,
        otherParticipants: conversation.participants.map((p) => ({
          userId: p.userId,
          displayName: p.user.displayName ?? p.user.email,
          role: p.role,
        })),
      };
    });

  return (
    <main className="space-y-6">
      <PageHeader
        title="Inbox"
        description="Direct messages with members. Broadcasts and announcements are managed under Communications."
        actions={[{ href: "/communications", label: "Communications" }, { href: "/dashboard", label: "Back to Dashboard" }]}
      />

      {can("messages:write") && composeMemberId ? (
        <SectionCard title="New Message" description={composeMemberName ? `Start a conversation with ${composeMemberName}.` : "Start a new conversation."}>
          <NewConversationForm memberId={composeMemberId} memberName={composeMemberName} />
        </SectionCard>
      ) : null}

      <SectionCard title="Conversations" description="Sorted by most recent activity.">
        <InboxList initialConversations={conversations} />
      </SectionCard>
    </main>
  );
}
