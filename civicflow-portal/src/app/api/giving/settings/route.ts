import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { getGivingSettings, setGivingSettings } from "@/lib/giving/module";
import { parseJsonBody, z } from "@/lib/validation";

/** GET — module flag + terminology. Readable by any giving-capability
 * holder (the setup page gate). */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("contributions:summary:view", "throw");
    const settings = await getGivingSettings(organizationId);
    return Response.json({ ok: true, data: settings });
  });
}

const putSchema = z.object({
  contributionsEnabled: z.boolean().optional(),
  contributionTerminology: z.string().max(40).nullable().optional(),
  householdGivingEnabled: z.boolean().optional(),
  householdGivingPrivacyMode: z
    .enum(["INDIVIDUAL_PRIVATE", "HOUSEHOLD_STATEMENT_ONLY", "HOUSEHOLD_SHARED"])
    .optional(),
});

/** PUT — enable/disable the module and set terminology. Deliberately held to
 * funds-manage authority: switching giving on is a financial-configuration
 * act, audited as such. */
export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("contributions:funds:manage", "throw");
    const input = await parseJsonBody(request, putSchema);
    await setGivingSettings({
      organizationId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    const settings = await getGivingSettings(organizationId);
    return Response.json({ ok: true, data: settings });
  });
}
