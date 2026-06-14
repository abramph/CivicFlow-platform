import type { MemberTimelineEventType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function createMemberTimelineEvent(input: {
  organizationId: string;
  memberId: string;
  eventType: MemberTimelineEventType;
  title: string;
  description?: string | null;
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  occurredAt?: Date;
  createdByUserId?: string | null;
}) {
  return prisma.memberTimelineEvent.create({
    data: {
      organizationId: input.organizationId,
      memberId: input.memberId,
      eventType: input.eventType,
      title: input.title,
      description: input.description ?? null,
      oldValue: input.oldValue,
      newValue: input.newValue,
      occurredAt: input.occurredAt ?? new Date(),
      createdByUserId: input.createdByUserId ?? null,
    },
  });
}

