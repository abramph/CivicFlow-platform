import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody, z } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { requireRateLimit } from "@/lib/rate-limit";
import { requireMemberSlot } from "@/lib/plan-gate";

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

const createMemberSchema = z.object({
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

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("members:read", "throw");

    const rows = await prisma.orgMember.findMany({
      where: { organizationId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 200,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "member",
      metadata: { count: rows.length },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:members:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("members:write", "throw");

    await requireMemberSlot(organizationId);

    const input = await parseJsonBody(request, createMemberSchema);
    const membershipCategoryId = normalizeOptionalText(input.membershipCategoryId);

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
      actorUserId: session.userId,
      actorEmail: session.userEmail,
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
      createdByUserId: session.userId,
    });

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
