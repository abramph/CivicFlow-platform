import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { withApiErrorHandling } from "@/lib/api-route";
import { getOrganizationLabAccess } from "@/lib/labs/access";

/**
 * Lightweight availability check the widget calls once on mount so it can
 * stay entirely unrendered when not enabled -- an internal-only Labs feature
 * must be invisible to an ordinary organization, not visible-but-disabled
 * (see src/lib/labs/access.ts's listOrganizationLabAccess doc comment).
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    const session = await getServerSession(authOptions);
    // Must match POST /api/support-assistant's isAuthenticated check exactly
    // (including `role`) -- a mismatch here would show the widget button for
    // a session the real request would treat as unauthenticated (or vice
    // versa), landing on a confusing 403 the first time it's used.
    const isAuthenticated = Boolean(session?.userId && session?.organizationId && session?.role);

    if (isAuthenticated) {
      const access = await getOrganizationLabAccess(session!.organizationId!, "supportAssistant");
      return Response.json({ ok: true, data: { available: access.available, mode: "authenticated" } });
    }

    return Response.json({ ok: true, data: { available: process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED === "1", mode: "public" } });
  });
}
