import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { getMyHouseholdGiving } from "@/lib/giving/households";

/** CORE-GIVE-H — the caller's OWN household giving view. The household is
 * derived server-side from the caller's member row; the privacy-mode gate
 * lives in getMyHouseholdGiving (§29) and this route adds nothing on top. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("org") ?? "";
    const memberSession = await requireMemberWebSession(organizationId);
    const yearParam = Number(searchParams.get("year"));
    const year = Number.isInteger(yearParam) && yearParam > 2000 ? yearParam : new Date().getFullYear();

    if (!memberSession.memberId) return Response.json({ ok: true, data: { visibility: "NONE" } });
    const view = await getMyHouseholdGiving(memberSession.organizationId, memberSession.memberId, year);
    return Response.json({ ok: true, data: view });
  });
}
