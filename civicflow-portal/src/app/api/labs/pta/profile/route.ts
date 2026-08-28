import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { getPtaProfile, upsertPtaProfile } from "@/lib/labs/pta/profile";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:analytics:read");
    const profile = await getPtaProfile(organizationId);
    return Response.json({ ok: true, data: profile });
  });
}

const bodySchema = z.object({
  schoolOrPtaName: z.string().min(1),
  designation: z.enum(["PTA", "PTO"]).optional(),
  currentSchoolYear: z.string().min(1),
  schoolAddress: z.string().nullable().optional(),
  schoolWebsite: z.string().nullable().optional(),
  principalName: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
  membershipModel: z.enum(["INDIVIDUAL", "HOUSEHOLD", "FAMILY"]).optional(),
  defaultDuesAmountCents: z.number().int().nullable().optional(),
  gradesServed: z.array(z.string()).optional(),
  concernsEnabled: z.boolean().optional(),
  concernsLabel: z.string().max(80).nullable().optional(),
  electionsEnabled: z.boolean().optional(),
  ptaVolunteerRequirementsEnabled: z.boolean().optional(),
  ptaVolunteerBuyoutEnabled: z.boolean().optional(),
  ptaVolunteerAssessmentsEnabled: z.boolean().optional(),
  ptaVolunteerReportsEnabled: z.boolean().optional(),
  ptaVolunteerNotificationsEnabled: z.boolean().optional(),
  ptaVolunteerNativeMobileEnabled: z.boolean().optional(),
});

export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:households:manage");
    const input = await parseJsonBody(request, bodySchema);
    // PTA-E: the concerns feature switch/label is governance surface — held
    // to pta:concerns:manage (ORG_ADMIN+), not general profile editing.
    if (input.concernsEnabled !== undefined || input.concernsLabel !== undefined) {
      await requirePtaAccess("pta:concerns:manage");
    }
    // PTA-L: the elections switch is election-management authority.
    if (input.electionsEnabled !== undefined) {
      await requirePtaAccess("pta:elections:manage");
    }
    // Volunteer Hour Requirements & Buyout program (docs/pta-volunteer-hours.md):
    // each of the six flags is gated by the permission that most directly
    // owns that capability, not a single catch-all — so a Treasurer who
    // holds buyout-pricing:manage can turn buyout on without also being
    // able to turn on the requirements/assessments machinery, and vice
    // versa. Native-mobile is reserved/inert this phase but still gated for
    // consistency with the others.
    if (
      input.ptaVolunteerRequirementsEnabled !== undefined ||
      input.ptaVolunteerNotificationsEnabled !== undefined ||
      input.ptaVolunteerNativeMobileEnabled !== undefined
    ) {
      await requirePtaAccess("pta:volunteer-requirements:manage");
    }
    if (input.ptaVolunteerBuyoutEnabled !== undefined) {
      await requirePtaAccess("pta:volunteer-buyout-pricing:manage");
    }
    if (input.ptaVolunteerAssessmentsEnabled !== undefined) {
      await requirePtaAccess("pta:volunteer-assessments:preview-post");
    }
    if (input.ptaVolunteerReportsEnabled !== undefined) {
      await requirePtaAccess("pta:volunteer-reports:export");
    }
    const profile = await upsertPtaProfile({ organizationId, actorUserId: session.userId, actorEmail: session.userEmail, ...input });
    return Response.json({ ok: true, data: profile });
  });
}
