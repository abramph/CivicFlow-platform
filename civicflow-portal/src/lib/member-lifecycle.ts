import type { OrgMember } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { sendPushToMember } from "@/lib/push";
import { MemberLifecycleError } from "@/lib/member-lifecycle-errors";
import { TERMINATION_REASONS } from "@/lib/member-lifecycle-reasons";

/**
 * Member termination / reinstatement — service layer. Every write to
 * membershipStatus involving "terminated" goes through here, never a raw
 * `prisma.orgMember.update({ data: { membershipStatus: ... } })` at a call
 * site. See docs/member-lifecycle-termination.md for the design rationale.
 */

export { TERMINATION_REASONS } from "@/lib/member-lifecycle-reasons";
export type { TerminationReasonCode } from "@/lib/member-lifecycle-reasons";

const ACTIVE_OWNER_ROLES = ["ORG_OWNER", "SUPER_ADMIN"] as const;

const EFFECTIVE_DATE_BOUND_MS = 5 * 365 * 24 * 60 * 60 * 1000;

function assertValidEffectiveDate(raw: string | undefined): Date {
  if (!raw) {
    throw new MemberLifecycleError("INVALID_EFFECTIVE_DATE", "An effective date is required.");
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new MemberLifecycleError("INVALID_EFFECTIVE_DATE", "The effective date is not a valid date.");
  }
  const deltaMs = Math.abs(date.getTime() - Date.now());
  if (deltaMs > EFFECTIVE_DATE_BOUND_MS) {
    throw new MemberLifecycleError("INVALID_EFFECTIVE_DATE", "The effective date must be within 5 years of today.");
  }
  return date;
}

function resolveReasonText(reasonCode: string | undefined, reasonOther: string | undefined): string {
  if (!reasonCode) {
    throw new MemberLifecycleError("TERMINATION_REASON_REQUIRED", "A termination reason is required.");
  }
  const known = TERMINATION_REASONS.find((r) => r.value === reasonCode);
  if (!known) {
    throw new MemberLifecycleError("TERMINATION_REASON_REQUIRED", "Unrecognized termination reason.");
  }
  if (known.value === "OTHER") {
    const trimmed = (reasonOther ?? "").trim();
    if (!trimmed) {
      throw new MemberLifecycleError("TERMINATION_REASON_REQUIRED", 'A description is required when reason is "Other".');
    }
    return trimmed;
  }
  return known.label;
}

export async function terminateMember(input: {
  organizationId: string;
  memberId: string;
  actorUserId: string;
  actorEmail?: string | null;
  reasonCode: string | undefined;
  reasonOther?: string;
  effectiveDate: string | undefined;
  internalNotes?: string | null;
}): Promise<OrgMember> {
  const reasonText = resolveReasonText(input.reasonCode, input.reasonOther);
  const effectiveDate = assertValidEffectiveDate(input.effectiveDate);

  const { updated, previousStatus, suspendedMembershipId } = await prisma.$transaction(async (tx) => {
    const existing = await tx.orgMember.findFirst({ where: { id: input.memberId, organizationId: input.organizationId } });
    if (!existing) {
      throw new MemberLifecycleError("MEMBER_NOT_FOUND", "Member not found.");
    }
    if (existing.membershipStatus === "terminated") {
      throw new MemberLifecycleError("MEMBER_ALREADY_TERMINATED", "This member is already terminated.");
    }

    let suspendedMembershipId: string | null = null;
    if (existing.userId) {
      const activeMemberships = await tx.organizationMembership.findMany({
        where: { organizationId: input.organizationId, status: "active" },
        select: { id: true, userId: true, role: true },
      });
      const linked = activeMemberships.find((m) => m.userId === existing.userId);
      if (linked && (ACTIVE_OWNER_ROLES as readonly string[]).includes(linked.role)) {
        const otherActiveOwners = activeMemberships.filter(
          (m) => m.userId !== existing.userId && (ACTIVE_OWNER_ROLES as readonly string[]).includes(m.role)
        );
        if (otherActiveOwners.length === 0) {
          throw new MemberLifecycleError(
            "LAST_OWNER_CANNOT_BE_TERMINATED",
            "This member holds the organization's only active owner access. Assign owner access to another user before terminating this member."
          );
        }
      }
      if (linked) {
        suspendedMembershipId = linked.id;
      }
    }

    const { count } = await tx.orgMember.updateMany({
      where: { id: existing.id, organizationId: input.organizationId, membershipStatus: { not: "terminated" } },
      data: {
        membershipStatus: "terminated",
        statusChangedAt: effectiveDate,
        statusChangedByUserId: input.actorUserId,
        statusChangeReason: reasonText,
      },
    });
    if (count === 0) {
      throw new MemberLifecycleError("MEMBER_ALREADY_TERMINATED", "This member was just terminated by someone else. Refresh and try again.");
    }

    if (suspendedMembershipId) {
      await tx.organizationMembership.update({
        where: { id: suspendedMembershipId },
        data: { status: "suspended" },
      });
    }

    const updated = await tx.orgMember.findUniqueOrThrow({ where: { id: existing.id } });
    return { updated, previousStatus: existing.membershipStatus, suspendedMembershipId };
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: "terminate",
    entityType: "member",
    entityId: updated.id,
    metadata: { before: { membershipStatus: previousStatus }, after: { membershipStatus: updated.membershipStatus }, reasonCode: input.reasonCode, accessSuspended: Boolean(suspendedMembershipId) },
  });

  await createMemberTimelineEvent({
    organizationId: input.organizationId,
    memberId: updated.id,
    eventType: "TERMINATED",
    title: "Membership terminated",
    description: input.internalNotes ? `${reasonText} — ${input.internalNotes}` : reasonText,
    oldValue: { membershipStatus: previousStatus },
    newValue: { membershipStatus: "terminated", reasonCode: input.reasonCode, reason: reasonText, effectiveDate: effectiveDate.toISOString(), accessSuspended: Boolean(suspendedMembershipId) },
    occurredAt: effectiveDate,
    createdByUserId: input.actorUserId,
  });

  await sendPushToMember({
    organizationId: input.organizationId,
    memberId: updated.id,
    title: "Membership Status Update",
    body: "Your membership status is now: Terminated.",
    deepLink: "/dues",
    required: true,
  }).catch(() => null);

  return updated;
}

export async function reinstateMember(input: {
  organizationId: string;
  memberId: string;
  actorUserId: string;
  actorEmail?: string | null;
  reason: string | undefined;
  effectiveDate: string | undefined;
  internalNotes?: string | null;
}): Promise<OrgMember> {
  const trimmedReason = (input.reason ?? "").trim();
  if (!trimmedReason) {
    throw new MemberLifecycleError("REINSTATEMENT_REASON_REQUIRED", "A reinstatement reason is required.");
  }
  const effectiveDate = assertValidEffectiveDate(input.effectiveDate);

  const { updated, previousStatus } = await prisma.$transaction(async (tx) => {
    const existing = await tx.orgMember.findFirst({ where: { id: input.memberId, organizationId: input.organizationId } });
    if (!existing) {
      throw new MemberLifecycleError("MEMBER_NOT_FOUND", "Member not found.");
    }
    if (existing.membershipStatus !== "terminated") {
      throw new MemberLifecycleError("MEMBER_NOT_TERMINATED", "This member is not currently terminated.");
    }

    const { count } = await tx.orgMember.updateMany({
      where: { id: existing.id, organizationId: input.organizationId, membershipStatus: "terminated" },
      data: {
        membershipStatus: "active",
        statusChangedAt: effectiveDate,
        statusChangedByUserId: input.actorUserId,
        statusChangeReason: trimmedReason,
      },
    });
    if (count === 0) {
      throw new MemberLifecycleError("MEMBER_NOT_TERMINATED", "This member was just reinstated by someone else. Refresh and try again.");
    }

    const updated = await tx.orgMember.findUniqueOrThrow({ where: { id: existing.id } });
    return { updated, previousStatus: existing.membershipStatus };
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: "reinstate",
    entityType: "member",
    entityId: updated.id,
    metadata: { before: { membershipStatus: previousStatus }, after: { membershipStatus: updated.membershipStatus } },
  });

  await createMemberTimelineEvent({
    organizationId: input.organizationId,
    memberId: updated.id,
    eventType: "REACTIVATED",
    title: "Membership reinstated",
    description: input.internalNotes ? `${trimmedReason} — ${input.internalNotes}` : trimmedReason,
    oldValue: { membershipStatus: "terminated" },
    newValue: { membershipStatus: "active", reason: trimmedReason, effectiveDate: effectiveDate.toISOString() },
    occurredAt: effectiveDate,
    createdByUserId: input.actorUserId,
  });

  await sendPushToMember({
    organizationId: input.organizationId,
    memberId: updated.id,
    title: "Membership Status Update",
    body: "Your membership status is now: Active.",
    deepLink: "/dues",
    required: true,
  }).catch(() => null);

  return updated;
}
