import { withApiErrorHandling } from "@/lib/api-route";
import { requireOrganization } from "@/lib/auth-guards";
import { getOrganizationLabAccess } from "@/lib/labs/access";

/**
 * Read-only: is "Unestra for PTA" available for the caller's ACTIVE organization
 * right now. organizationId always comes from the session, never a client
 * parameter. This exists purely to let client-rendered navigation (the
 * sidebar) decide whether to show a PTA entry point at all — see
 * PortalShell.tsx. There was no existing route that exposed Labs
 * availability to a client component (settings/labs/page.tsx reads it
 * server-side only), and Phase 17 of the UI integration sprint requires the
 * nav to never advertise Labs features to an unenrolled organization.
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireOrganization();
    const access = await getOrganizationLabAccess(organizationId, "ptaVertical");
    return Response.json({ ok: true, data: { available: access.available } });
  });
}
