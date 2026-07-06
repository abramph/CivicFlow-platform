import { withApiErrorHandling } from "@/lib/api-route";
import { getMemberWebSession } from "@/lib/member-web-session";

/**
 * GET /api/member-portal/session?org=... — lets the member portal's client-side
 * shell (nav drawer, org switcher) read the current org context without
 * needing searchParams in a layout, which Next.js doesn't provide.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const org = searchParams.get("org") ?? undefined;

    const session = await getMemberWebSession(org);
    if (!session) {
      return Response.json({ ok: true, data: null });
    }

    return Response.json({
      ok: true,
      data: {
        organizationId: session.organizationId,
        organizationName: session.organizationName,
        organizationLogoUrl: session.organizationLogoUrl,
        organizations: session.organizations,
      },
    });
  });
}
