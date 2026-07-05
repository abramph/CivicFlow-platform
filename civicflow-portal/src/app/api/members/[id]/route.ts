import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { formatEnumLabel } from "@/lib/formatting";
import { parseJsonBody, z } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { sendPushToMember } from "@/lib/push";
import { requireRateLimit } from "@/lib/rate-limit";

const optionalTextField = (maxLength: number) =>
  z.union([z.string().trim().max(maxLength), z.literal(""), z.null()]).optional();

const optionalEmailField = z.union([z.string().trim().email(), z.literal(""), z.null()]).optional();
const optionalDateTimeField = z.union([z.string().datetime(), z.literal(""), z.null()]).optional();
const optionalMembershipCategoryField = z
  .union([z.string().trim().min(1).max(120), z.literal(""), z.null()])
  .optional();

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalDate(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (!value) return null;
  return new Date(value);
}

const updateMemberSchema = z.object({
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
  commsSmsEnabled: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:members:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("members:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, updateMemberSchema);
    const membershipCategoryId = normalizeOptionalText(input.membershipCategoryId);

    const existing = await prisma.orgMember.findFirst({ where: { id, organizationId } });
    if (!existing) {
      return Response.json({ ok: false, error: "Member not found" }, { status: 404 });
    }

    if (membershipCategoryId) {
      const membershipCategory = await prisma.category.findFirst({
        where: {
          id: membershipCategoryId,
          organizationId,
          type: "MEMBERSHIP",
        },
      });

      if (!membershipCategory) {
        return Response.json(
          { ok: false, error: "Membership category not found in organization" },
          { status: 404 }
        );
      }
    }

    if (
      input.membershipStatus &&
      input.membershipStatus !== existing.membershipStatus &&
      ["deactivated", "terminated", "suspended"].includes(input.membershipStatus) &&
      !normalizeOptionalText(input.statusChangeReason)
    ) {
      return Response.json(
        { ok: false, error: "Status change reason is required for suspended, deactivated, or terminated members." },
        { status: 400 }
      );
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
            statusChangedByUserId: session.userId,
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
      ...(input.commsSmsEnabled !== undefined ? { commsSmsEnabled: input.commsSmsEnabled } : {}),
    };

    const updated = await prisma.orgMember.update({
      where: { id },
      data,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
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
      oldValue: {
        membershipStatus: existing.membershipStatus,
        membershipCategoryId: existing.membershipCategoryId,
      },
      newValue: {
        membershipStatus: updated.membershipStatus,
        membershipCategoryId: updated.membershipCategoryId,
      },
      createdByUserId: session.userId,
    });

    if (existing.membershipStatus !== updated.membershipStatus) {
      const eventType =
        updated.membershipStatus === "deactivated"
          ? "DEACTIVATED"
          : updated.membershipStatus === "terminated"
            ? "TERMINATED"
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
        createdByUserId: session.userId,
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
        createdByUserId: session.userId,
      });
    }

    return Response.json({ ok: true, data: updated });
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:members:write",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("members:write", "throw");
    const { id } = await params;

    const existing = await prisma.orgMember.findFirst({ where: { id, organizationId } });
    if (!existing) {
      return Response.json({ ok: false, error: "Member not found" }, { status: 404 });
    }

    await prisma.orgMember.delete({ where: { id } });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "delete",
      entityType: "member",
      entityId: id,
      metadata: { deleted: { id, email: existing.email } },
    });

    return Response.json({ ok: true });
  });
}
