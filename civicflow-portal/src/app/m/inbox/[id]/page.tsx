import { notFound } from "next/navigation";
import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { MemberConversationReplyForm } from "@/components/forms/MemberConversationReplyForm";
import { formatDateTime } from "@/lib/formatting";
import { getMemberWebSession } from "@/lib/member-web-session";
import { prisma } from "@/lib/prisma";

export default async function MemberConversationThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { id } = await params;
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink={`conversation/${id}`} title="Conversation" />
      </div>
    );
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id, organizationId: memberSession.organizationId, participants: { some: { userId: memberSession.userId } } },
    include: {
      participants: { include: { user: { select: { id: true, displayName: true, email: true } } } },
    },
  });
  if (!conversation) notFound();

  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    include: { sender: { select: { id: true, displayName: true, email: true } } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  await prisma.conversationParticipant.updateMany({
    where: { conversationId: id, userId: memberSession.userId },
    data: { lastReadAt: new Date() },
  });

  const otherNames = conversation.participants
    .filter((p) => p.userId !== memberSession.userId)
    .map((p) => p.user.displayName ?? p.user.email)
    .join(", ");

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6" style={{ minHeight: "calc(100vh - 57px)" }}>
      <h1 className="text-2xl font-bold text-slate-900">{conversation.subject || otherNames || "Conversation"}</h1>

      <div className="flex-1 space-y-3">
        {messages.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-600">
            No messages yet — say hello.
          </p>
        ) : (
          messages.map((message) => {
            const isMine = message.senderUserId === memberSession.userId;
            return (
              <div key={message.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                    isMine ? "bg-emerald-600 text-white" : "border border-slate-200 bg-white text-slate-900"
                  }`}
                >
                  {!isMine ? (
                    <p className={`mb-1 text-xs font-semibold ${isMine ? "text-emerald-100" : "text-slate-500"}`}>
                      {message.sender.displayName ?? message.sender.email}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap">{message.body}</p>
                  <p className={`mt-1 text-xs ${isMine ? "text-emerald-100" : "text-slate-400"}`}>
                    {formatDateTime(message.createdAt)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <MemberConversationReplyForm organizationId={memberSession.organizationId} conversationId={id} />
    </main>
  );
}
