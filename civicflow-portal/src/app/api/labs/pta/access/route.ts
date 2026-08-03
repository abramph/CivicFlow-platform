import { withApiErrorHandling } from "@/lib/api-route";
import { requireOrganization } from "@/lib/auth-guards";
import { checkPtaVerticalAvailable } from "@/lib/labs/pta/guard";

/**
 * Read-only: is the PTA experience available for the caller's ACTIVE
 * organization right now. organizationId always comes from the session,
 * never a client parameter. This exists purely to let client-rendered
 * navigation (the sidebar) decide whether to show a PTA entry point at all
 * — see PortalShell.tsx. As of PR #40 this is a plain
 * Organization.primaryVertical === "PTA" check, not a Labs lookup.
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireOrganization("throw");
    const access = await checkPtaVerticalAvailable(organizationId);
    return Response.json({ ok: true, data: { available: access.available } });
  });
}
