import { withApiErrorHandling } from "@/lib/api-route";
import { isPtaVolunteerHoursOrgAllowed, isPtaVolunteerHoursPlatformEnabled } from "@/lib/env";
import { PtaError } from "@/lib/labs/pta/errors";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { getPtaProfile, upsertPtaProfile } from "@/lib/labs/pta/profile";
import { VOLUNTEER_HOURS_FLAG_KEYS, updatePtaVolunteerHoursFlags } from "@/lib/labs/pta/volunteer-hours/flags";
import { parseJsonBody, z } from "@/lib/validation";

const VOLUNTEER_HOURS_FLAG_FIELDS = VOLUNTEER_HOURS_FLAG_KEYS;

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
}).strict();

export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:households:manage");
    const input = await parseJsonBody(request, bodySchema);
    // Volunteer Hour Requirements & Buyout program: reject any attempt to
    // change one of the six org-level flags while the platform kill-switch
    // is off, OR while this organization isn't on the pilot allowlist —
    // fails closed even for a direct API call, so a non-pilot org can never
    // pre-stage itself to activate the instant the platform switch or
    // allowlist later change. Checked before any RBAC-scoped sub-check
    // below, since this is a platform-wide gate, not a per-capability
    // permission question. Both cases throw the identical error — a caller
    // must not be able to tell "platform is off" from "not allowlisted"
    // from the response alone.
    const touchesVolunteerHoursFlags = VOLUNTEER_HOURS_FLAG_FIELDS.some((field) => input[field] !== undefined);
    if (touchesVolunteerHoursFlags && !isPtaVolunteerHoursPlatformEnabled()) {
      throw new PtaError(
        "PTA_VOLUNTEER_HOURS_PLATFORM_DISABLED",
        "Volunteer hour requirements are not available on this platform."
      );
    }
    if (touchesVolunteerHoursFlags && !isPtaVolunteerHoursOrgAllowed(organizationId)) {
      throw new PtaError(
        "PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED",
        "Volunteer hour requirements are not available on this platform."
      );
    }
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

    // fix/pta-volunteer-settings-atomic-audit: the six flags are no longer
    // accepted by upsertPtaProfile() at all — every RBAC check above stays
    // exactly as it was (still per-flag, still checked before any write),
    // but the actual mutation for these six columns now goes through
    // updatePtaVolunteerHoursFlags(), which updates the flag(s) and writes
    // their audit event in a single transaction. upsertPtaProfile() runs
    // FIRST — it create-if-missing's the profile row, so a brand-new org
    // that saves flags before ever saving its base profile still gets a row
    // for the flags step to find, exactly matching the old combined
    // upsert's behavior for that edge case.
    const {
      ptaVolunteerRequirementsEnabled,
      ptaVolunteerBuyoutEnabled,
      ptaVolunteerAssessmentsEnabled,
      ptaVolunteerReportsEnabled,
      ptaVolunteerNotificationsEnabled,
      ptaVolunteerNativeMobileEnabled,
      ...profileFields
    } = input;
    await upsertPtaProfile({ organizationId, actorUserId: session.userId, actorEmail: session.userEmail, ...profileFields });

    if (touchesVolunteerHoursFlags) {
      await updatePtaVolunteerHoursFlags({
        organizationId,
        actorUserId: session.userId,
        actorEmail: session.userEmail,
        changes: {
          ...(ptaVolunteerRequirementsEnabled !== undefined ? { ptaVolunteerRequirementsEnabled } : {}),
          ...(ptaVolunteerBuyoutEnabled !== undefined ? { ptaVolunteerBuyoutEnabled } : {}),
          ...(ptaVolunteerAssessmentsEnabled !== undefined ? { ptaVolunteerAssessmentsEnabled } : {}),
          ...(ptaVolunteerReportsEnabled !== undefined ? { ptaVolunteerReportsEnabled } : {}),
          ...(ptaVolunteerNotificationsEnabled !== undefined ? { ptaVolunteerNotificationsEnabled } : {}),
          ...(ptaVolunteerNativeMobileEnabled !== undefined ? { ptaVolunteerNativeMobileEnabled } : {}),
        },
      });
    }

    // Re-fetch once for a single, accurate combined response — profile
    // (above) doesn't reflect the flags step's own write, and the flags
    // step's returned row doesn't reflect a concurrent unrelated-field edit
    // by someone else that could have landed between the two calls.
    const finalProfile = await getPtaProfile(organizationId);
    return Response.json({ ok: true, data: finalProfile });
  });
}
