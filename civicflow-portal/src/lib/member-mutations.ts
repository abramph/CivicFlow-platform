import type { OrgMember } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { sendPushToMember } from "@/lib/push";
import { formatEnumLabel } from "@/lib/formatting";
import { requireMemberSlot } from "@/lib/plan-gate";
import { z } from "@/lib/validation";

/**
 * Shared OrgMember create/update business logic — used by both the web
 * portal routes (src/app/api/members/route.ts, [id]/route.ts) and the
 * mobile admin routes (src/app/api/mobile/admin/members/*). Extracted so
 * neither surface can drift from the other's validation, plan-gating,
 * audit, or timeline behavior. "terminated" is never reachable through
 * either function here — see src/lib/member-lifecycle.ts.
 */

export const optionalTextField = (maxLength: number) =>
  z.union([z.string().trim().max(maxLength), z.literal(""), z.null()]).optional();

export const optionalEmailField = z.union([z.string().trim().email(), z.literal(""), z.null()]).optional();
export const optionalDateTimeField = z.union([z.string().datetime(), z.literal(""), z.null()]).optional();
export const optionalMembershipCategoryField = z
  .union([z.string().trim().min(1).max(120), z.literal(""), z.null()])
  .optional();

export function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeOptionalDate(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (!value) return null;
  return new Date(value);
}

export const createMemberSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  preferredName: optionalTextField(120),
  email: optionalEmailField,
  phone: optionalTextField(50),
  membershipStatus: z.enum(["active", "retired", "suspended", "terminated"]).optional(),
  joinDate: optionalDateTimeField,
  dateOfBirth: optionalDateTimeField,
  gender: optionalTextField(80),
  addressLine1: optionalTextField(255),
  addressLine2: optionalTextField(255),
  city: optionalTextField(120),
  state: optionalTextField(120),
  zipCode: optionalTextField(30),
  county: optionalTextField(120),
  country: optionalTextField(120),
  membershipCategoryId: optionalMembershipCategoryField,
  householdName: optionalTextField(160),
  emergencyContactName: optionalTextField(160),
  emergencyContactPhone: optionalTextField(50),
  notes: optionalTextField(4000),
});
export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const updateMemberSchema = z.object({
  firstName: z.string().trim().min(1).max(120).optional(),
  lastName: z.string().trim().min(1).max(120).optional(),
  preferredName: optionalTextField(120),
  email: optionalEmailField,
  phone: optionalTextField(50),
  notes: optionalTextField(4000),
  membershipStatus: z.enum(["active", "inactive", "deactivated", "pending", "retired", "suspended", "terminated"]).optional(),
  statusChangeReason: optionalTextField(1000),
  joinDate: optionalDateTimeField,
  dateOfBirth: optionalDateTimeField,
  gender: optionalTextField(80),
  addressLine1: optionalTextField(255),
  addressLine2: optionalTextField(255),
  city: optionalTextField(120),
  state: optionalTextField(120),
  zipCode: optionalTextField(30),
  county: optionalTextField(120),
  country: optionalTextField(120),
  membershipCategoryId: optionalMembershipCategoryField,
  membershipCategoryManualOverride: z.boolean().optional(),
  householdName: optionalTextField(160),
  emergencyContactName: optionalTextField(160),
  emergencyContactPhone: optionalTextField(50),
  commsPushEnabled: z.boolean().optional(),
  commsEmailEnabled: z.boolean().optional(),
  commsSmsEnabled: z.boolean().optional(),
});
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export interface MemberMutationActor {
  /**
   * Null represents an automated, policy-gated system action with no human
   * on the other end (e.g. a Member Intake submission auto-applied under an
   * org's own configured policy after successful identity verification --
   * see src/lib/member-intake/update-engine.ts). Every downstream sink here
   * (createAuditEvent, createMemberTimelineEvent, statusChangedByUserId) is
   * already nullable for exactly this reason -- never invent a synthetic
   * "system user" row just to satisfy a non-null type.
   */
  userId: string | null;
  userEmail?: string | null;
}

export type MemberMutationResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function validateMembershipCategory(organizationId: string, membershipCategoryId: string | null) {
  if (!membershipCategoryId) return true;
  const membershipCategory = await prisma.category.findFirst({
    where: { id: membershipCategoryId, organizationId, type: "MEMBERSHIP" },
  });
  return Boolean(membershipCategory);
}

export async function createMember(
  organizationId: string,
  actor: MemberMutationActor,
  input: CreateMemberInput
): Promise<MemberMutationResult<OrgMember>> {
  await requireMemberSlot(organizationId);

  const membershipCategoryId = normalizeOptionalText(input.membershipCategoryId);
  if (membershipCategoryId && !(await validateMembershipCategory(organizationId, membershipCategoryId))) {
    return { ok: false, status: 404, error: "Membership category not found in organization" };
  }

  const row = await prisma.orgMember.create({
    data: {
      organizationId,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      preferredName: normalizeOptionalText(input.preferredName) ?? null,
      email: normalizeOptionalText(input.email) ?? null,
      phone: normalizeOptionalText(input.phone) ?? null,
      membershipStatus: input.membershipStatus ?? "active",
      joinDate: normalizeOptionalDate(input.joinDate) ?? null,
      dateOfBirth: normalizeOptionalDate(input.dateOfBirth) ?? null,
      gender: normalizeOptionalText(input.gender) ?? null,
      addressLine1: normalizeOptionalText(input.addressLine1) ?? null,
      addressLine2: normalizeOptionalText(input.addressLine2) ?? null,
      city: normalizeOptionalText(input.city) ?? null,
      state: normalizeOptionalText(input.state) ?? null,
      zipCode: normalizeOptionalText(input.zipCode) ?? null,
      county: normalizeOptionalText(input.county) ?? null,
      country: normalizeOptionalText(input.country) ?? null,
      membershipCategoryId: membershipCategoryId ?? null,
      householdName: normalizeOptionalText(input.householdName) ?? null,
      emergencyContactName: normalizeOptionalText(input.emergencyContactName) ?? null,
      emergencyContactPhone: normalizeOptionalText(input.emergencyContactPhone) ?? null,
      notes: normalizeOptionalText(input.notes) ?? null,
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "create",
    entityType: "member",
    entityId: row.id,
    metadata: {
      firstName: row.firstName,
      lastName: row.lastName,
      membershipStatus: row.membershipStatus,
      joinDate: row.joinDate?.toISOString() ?? null,
      membershipCategoryId: row.membershipCategoryId,
    },
  });

  await createMemberTimelineEvent({
    organizationId,
    memberId: row.id,
    eventType: "CREATED",
    title: "Member created",
    newValue: {
      firstName: row.firstName,
      lastName: row.lastName,
      membershipStatus: row.membershipStatus,
      membershipCategoryId: row.membershipCategoryId,
    },
    createdByUserId: actor.userId,
  });

  return { ok: true, data: row };
}

export async function updateMember(
  organizationId: string,
  actor: MemberMutationActor,
  memberId: string,
  input: UpdateMemberInput
): Promise<MemberMutationResult<OrgMember>> {
  const membershipCategoryId = normalizeOptionalText(input.membershipCategoryId);

  const existing = await prisma.orgMember.findFirst({ where: { id: memberId, organizationId } });
  if (!existing) {
    return { ok: false, status: 404, error: "Member not found" };
  }

  if (membershipCategoryId && !(await validateMembershipCategory(organizationId, membershipCategoryId))) {
    return { ok: false, status: 404, error: "Membership category not found in organization" };
  }

  if (
    input.membershipStatus &&
    input.membershipStatus !== existing.membershipStatus &&
    (input.membershipStatus === "terminated" || existing.membershipStatus === "terminated")
  ) {
    return {
      ok: false,
      status: 400,
      error:
        existing.membershipStatus === "terminated"
          ? "This member is terminated. Use the Reinstate action to restore membership."
          : "Use the Terminate action to terminate a member's status.",
    };
  }

  if (
    input.membershipStatus &&
    input.membershipStatus !== existing.membershipStatus &&
    ["deactivated", "suspended"].includes(input.membershipStatus) &&
    !normalizeOptionalText(input.statusChangeReason)
  ) {
    return { ok: false, status: 400, error: "Status change reason is required for suspended or deactivated members." };
  }

  const data = {
    ...(input.firstName !== undefined ? { firstName: input.firstName.trim() } : {}),
    ...(input.lastName !== undefined ? { lastName: input.lastName.trim() } : {}),
    ...(input.preferredName !== undefined ? { preferredName: normalizeOptionalText(input.preferredName) } : {}),
    ...(input.email !== undefined ? { email: normalizeOptionalText(input.email) } : {}),
    ...(input.phone !== undefined ? { phone: normalizeOptionalText(input.phone) } : {}),
    ...(input.notes !== undefined ? { notes: normalizeOptionalText(input.notes) } : {}),
    ...(input.membershipStatus !== undefined ? { membershipStatus: input.membershipStatus } : {}),
    ...(input.membershipStatus !== undefined && input.membershipStatus !== existing.membershipStatus
      ? {
          statusChangedAt: new Date(),
          statusChangedByUserId: actor.userId,
          statusChangeReason: normalizeOptionalText(input.statusChangeReason),
        }
      : {}),
    ...(input.joinDate !== undefined ? { joinDate: normalizeOptionalDate(input.joinDate) } : {}),
    ...(input.dateOfBirth !== undefined ? { dateOfBirth: normalizeOptionalDate(input.dateOfBirth) } : {}),
    ...(input.gender !== undefined ? { gender: normalizeOptionalText(input.gender) } : {}),
    ...(input.addressLine1 !== undefined ? { addressLine1: normalizeOptionalText(input.addressLine1) } : {}),
    ...(input.addressLine2 !== undefined ? { addressLine2: normalizeOptionalText(input.addressLine2) } : {}),
    ...(input.city !== undefined ? { city: normalizeOptionalText(input.city) } : {}),
    ...(input.state !== undefined ? { state: normalizeOptionalText(input.state) } : {}),
    ...(input.zipCode !== undefined ? { zipCode: normalizeOptionalText(input.zipCode) } : {}),
    ...(input.county !== undefined ? { county: normalizeOptionalText(input.county) } : {}),
    ...(input.country !== undefined ? { country: normalizeOptionalText(input.country) } : {}),
    ...(input.membershipCategoryId !== undefined ? { membershipCategoryId: membershipCategoryId ?? null } : {}),
    ...(input.membershipCategoryManualOverride !== undefined
      ? { membershipCategoryManualOverride: input.membershipCategoryManualOverride }
      : {}),
    ...(input.householdName !== undefined ? { householdName: normalizeOptionalText(input.householdName) } : {}),
    ...(input.emergencyContactName !== undefined
      ? { emergencyContactName: normalizeOptionalText(input.emergencyContactName) }
      : {}),
    ...(input.emergencyContactPhone !== undefined
      ? { emergencyContactPhone: normalizeOptionalText(input.emergencyContactPhone) }
      : {}),
    ...(input.commsPushEnabled !== undefined ? { commsPushEnabled: input.commsPushEnabled } : {}),
    ...(input.commsEmailEnabled !== undefined ? { commsEmailEnabled: input.commsEmailEnabled } : {}),
    ...(input.commsSmsEnabled !== undefined ? { commsSmsEnabled: input.commsSmsEnabled } : {}),
  };

  // Compare-and-swap on the status read above -- without this, a concurrent
  // dedicated terminate/reinstate call landing between the findFirst above
  // and this write would get silently overwritten by a stale membershipStatus,
  // clobbering a termination's status back to active while leaving its
  // OrganizationMembership access-suspension and timeline event in place.
  const { count } = await prisma.orgMember.updateMany({
    where: { id: existing.id, organizationId, membershipStatus: existing.membershipStatus },
    data,
  });
  if (count === 0) {
    return { ok: false, status: 409, error: "This member changed since you loaded this page. Refresh and try again." };
  }
  const updated = await prisma.orgMember.findUniqueOrThrow({ where: { id: existing.id } });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "update",
    entityType: "member",
    entityId: updated.id,
    metadata: { before: existing, after: updated },
  });

  await createMemberTimelineEvent({
    organizationId,
    memberId: updated.id,
    eventType: "UPDATED",
    title: "Member updated",
    oldValue: { membershipStatus: existing.membershipStatus, membershipCategoryId: existing.membershipCategoryId },
    newValue: { membershipStatus: updated.membershipStatus, membershipCategoryId: updated.membershipCategoryId },
    createdByUserId: actor.userId,
  });

  if (existing.membershipStatus !== updated.membershipStatus) {
    // "terminated" can no longer appear as either side of this transition --
    // it's only reachable via the dedicated terminate/reinstate actions
    // (see src/lib/member-lifecycle.ts), which write their own
    // TERMINATED/REACTIVATED timeline events.
    const eventType: "DEACTIVATED" | "SUSPENDED" | "RETIRED" | "REACTIVATED" | "STATUS_CHANGED" =
      updated.membershipStatus === "deactivated"
        ? "DEACTIVATED"
        : updated.membershipStatus === "suspended"
          ? "SUSPENDED"
          : updated.membershipStatus === "retired"
            ? "RETIRED"
            : existing.membershipStatus !== "active" && updated.membershipStatus === "active"
              ? "REACTIVATED"
              : "STATUS_CHANGED";
    await createMemberTimelineEvent({
      organizationId,
      memberId: updated.id,
      eventType,
      title: "Membership status changed",
      description: normalizeOptionalText(input.statusChangeReason),
      oldValue: { membershipStatus: existing.membershipStatus },
      newValue: { membershipStatus: updated.membershipStatus, reason: normalizeOptionalText(input.statusChangeReason) },
      createdByUserId: actor.userId,
    });

    await sendPushToMember({
      organizationId,
      memberId: updated.id,
      title: "Membership Status Update",
      body: `Your membership status is now: ${formatEnumLabel(updated.membershipStatus)}.`,
      deepLink: "/dues",
      required: true,
    }).catch(() => null);
  }

  if (existing.membershipCategoryId !== updated.membershipCategoryId) {
    await createMemberTimelineEvent({
      organizationId,
      memberId: updated.id,
      eventType: "CATEGORY_CHANGED",
      title: "Membership category changed",
      oldValue: { membershipCategoryId: existing.membershipCategoryId },
      newValue: { membershipCategoryId: updated.membershipCategoryId },
      createdByUserId: actor.userId,
    });
  }

  return { ok: true, data: updated };
}
