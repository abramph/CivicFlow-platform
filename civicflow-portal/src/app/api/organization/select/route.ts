import { cookies } from "next/headers";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireAuth } from "@/lib/auth-guards";
import { ACTIVE_ORG_COOKIE, getUserOrgMemberships } from "@/lib/org-context";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ organizationId: z.string().min(1) });

/**
 * POST /api/organization/select — the canonical org-switch endpoint for
 * both staff (dashboard/admin) and member (/m/*) surfaces. Persists the
 * chosen organization as the cf_active_org cookie so authOptions.ts's
 * session() callback resolves it on the very next request. organizationId
 * is re-verified against the caller's real OrganizationMembership rows
 * before being trusted — never taken from the request body blindly.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await parseJsonBody(request, bodySchema);
    const session = await requireAuth();

    const memberships = await getUserOrgMemberships(session.userId);
    const match = memberships.find((m) => m.organizationId === organizationId);
    if (!match) {
      return Response.json({ ok: false, error: "You are not a member of that organization." }, { status: 403 });
    }

    (await cookies()).set(ACTIVE_ORG_COOKIE, organizationId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    return Response.json({ ok: true, role: match.role, memberId: match.memberId });
  });
}
