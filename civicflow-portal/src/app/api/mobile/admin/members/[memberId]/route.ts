import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { requireMobileAdminAccess } from "@/lib/mobile-admin";
import { prisma } from "@/lib/prisma";
import { ValidationError, parseJsonBody, z } from "@/lib/validation";
import { requireRateLimit } from "@/lib/rate-limit";
import { updateMember, updateMemberSchema } from "@/lib/member-mutations";

const updateMobileMemberSchema = updateMemberSchema.extend({ organizationId: z.string().min(1) });

async function requireManageMembers(request: Request, organizationId: string) {
  const { userId, email } = await requireMobileAuth(request);
  const admin = await requireMobileAdminAccess(organizationId, userId);
  if (!admin.available || !admin.adminCapabilities.includes("manageMembers")) {
    throw new MobileForbiddenError("No mobile member administration access for this organization");
  }
  return { userId, email };
}

/**
 * GET /api/mobile/admin/members/[memberId]?organizationId=...
 * Always scoped by (id, organizationId) together — a memberId from another
 * organization simply doesn't match and returns 404, never leaking whether
 * the record exists elsewhere (same pattern as the web PATCH/DELETE routes).
 */
export async function GET(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireManageMembers(request, organizationId);
    const { memberId } = await params;

    const member = await prisma.orgMember.findFirst({ where: { id: memberId, organizationId } });
    if (!member) {
      return Response.json({ ok: false, error: "Member not found" }, { status: 404 });
    }

    return Response.json({ ok: true, data: member });
  });
}

/**
 * PATCH /api/mobile/admin/members/[memberId]
 * Body: { organizationId, ...updateMemberSchema fields }
 * Delegates to the same updateMember() the web edit form uses — status
 * can't be moved into/out of "terminated" here either (see
 * src/lib/member-mutations.ts); use the dedicated terminate/reinstate
 * routes below.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:members:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, ...input } = await parseJsonBody(request, updateMobileMemberSchema);
    const { userId, email } = await requireManageMembers(request, organizationId);
    const { memberId } = await params;

    const result = await updateMember(organizationId, { userId, userEmail: email }, memberId, input);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data });
  });
}
