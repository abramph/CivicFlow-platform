import { cookies } from "next/headers";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireOrganization } from "@/lib/auth-guards";
import { setupBannerDismissCookieName } from "@/lib/dashboard-setup";

/** Dismisses the dashboard "Finish organization setup" banner for the caller's active organization. See dashboard-setup.ts for why this is a cookie, not a DB column. */
export async function POST() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireOrganization();
    (await cookies()).set(setupBannerDismissCookieName(organizationId), "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return Response.json({ ok: true });
  });
}
