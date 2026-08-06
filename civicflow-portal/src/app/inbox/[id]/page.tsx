import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { ConversationThread, type ThreadMessage } from "@/components/app/ConversationThread";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, organizationId } = await requirePermission("messages:read");
  const { id } = await params;

  const conversation = await prisma.conversation.findFirst({
    where: { id, organizationId, participants: { some: { userId: session.userId } } },
    include: {
      participants: { include: { user: { select: { id: true, displayName: true, email: true } } } },
    },
  });

  if (!conversation) {
    return (
      <main className="space-y-6">
        <PageHeader title="Conversation not found" actions={[{ href: "/inbox", label: "Back to Inbox" }]} />
      </main>
    );
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    include: { sender: { select: { id: true, displayName: true, email: true } } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  await prisma.conversationParticipant.updateMany({
    where: { conversationId: id, userId: session.userId },
    data: { lastReadAt: new Date() },
  });

  const otherNames = conversation.participants
    .filter((p) => p.userId !== session.userId)
    .map((p) => p.user.displayName ?? p.user.email)
    .join(", ");

  const initialMessages: ThreadMessage[] = messages.map((m) => ({
    id: m.id,
    body: m.body,
    senderUserId: m.senderUserId,
    senderDisplayName: m.sender.displayName ?? m.sender.email,
    createdAt: m.createdAt.toISOString(),
  }));

  return (
    <main className="space-y-6">
      <PageHeader
        title={conversation.subject || otherNames || "Conversation"}
        description={conversation.subject ? otherNames : undefined}
        actions={[{ href: "/inbox", label: "Back to Inbox" }]}
      />
      <SectionCard title="Messages" description="Direct message thread — updates automatically.">
        <ConversationThread
          conversationId={conversation.id}
          currentUserId={session.userId}
          initialMessages={initialMessages}
          channel={conversation.channel}
          lastInboundAt={conversation.lastInboundAt ? conversation.lastInboundAt.toISOString() : null}
        />
      </SectionCard>
    </main>
  );
}
