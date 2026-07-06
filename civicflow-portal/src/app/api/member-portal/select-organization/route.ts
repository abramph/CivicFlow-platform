import { cookies } from "next/headers";
import { withApiErrorHandling } from "@/lib/api-route";
import { getMemberWebSession, MEMBER_ORG_COOKIE } from "@/lib/member-web-session";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ organizationId: z.string().min(1) });

/**
 * POST /api/member-portal/select-organization — persists a multi-org
 * member's chosen organization as a cookie, so it sticks across every link
 * in the member portal rather than only ones carrying `?org=`.
 * organizationId is re-verified against the caller's actual memberships
 * before being trusted (getMemberWebSession never trusts it blindly).
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await parseJsonBody(request, bodySchema);

    const session = await getMemberWebSession(organizationId);
    if (!session || session.organizationId !== organizationId) {
      return Response.json({ ok: false, error: "You are not a member of that organization." }, { status: 403 });
    }

    (await cookies()).set(MEMBER_ORG_COOKIE, organizationId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    return Response.json({ ok: true });
  });
}
