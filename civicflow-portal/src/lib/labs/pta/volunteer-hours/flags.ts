import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { isPtaVolunteerHoursOrgAllowed, isPtaVolunteerHoursPlatformEnabled } from "@/lib/env";
import { PtaError } from "../errors";

/**
 * fix/pta-volunteer-settings-atomic-audit: the ONLY code path in the
 * application allowed to write any of these six PtaProfile columns.
 * upsertPtaProfile() (profile.ts) no longer accepts them, by construction —
 * see that file's comment. This closes the gap that let a flag change
 * commit while its audit event failed independently (the original
 * upsertPtaProfile() did the profile write and the audit insert as two
 * separate, non-transactional statements).
 */
export const VOLUNTEER_HOURS_FLAG_KEYS = [
  "ptaVolunteerRequirementsEnabled",
  "ptaVolunteerBuyoutEnabled",
  "ptaVolunteerAssessmentsEnabled",
  "ptaVolunteerReportsEnabled",
  "ptaVolunteerNotificationsEnabled",
  "ptaVolunteerNativeMobileEnabled",
] as const;

export type VolunteerHoursFlagKey = (typeof VOLUNTEER_HOURS_FLAG_KEYS)[number];

export interface UpdatePtaVolunteerHoursFlagsInput {
  organizationId: string;
  /** Must be the authenticated caller's own session.userId — never a
   * client-supplied value. Required non-empty: this is what "a real
   * authenticated user" means at this layer, since request/session
   * resolution itself is the caller's (route's) responsibility, not this
   * function's — matching grantInternalOrganizationTrial()'s split between
   * route-level auth and service-level business logic. */
  actorUserId: string;
  actorEmail?: string | null;
  /** Only these six keys are ever read — an object built with `as any` from
   * an untrusted source cannot smuggle in an unrelated column, since
   * anything not in VOLUNTEER_HOURS_FLAG_KEYS is simply never looked at. */
  changes: Partial<Record<VolunteerHoursFlagKey, boolean>>;
}

export type VolunteerHoursFlagDelta = Partial<Record<VolunteerHoursFlagKey, { before: boolean; after: boolean }>>;

export interface UpdatePtaVolunteerHoursFlagsResult {
  profile: Prisma.PtaProfileGetPayload<Record<string, never>>;
  /** Empty for a true no-op (nothing requested actually differed from the
   * current value) — callers use this to distinguish "nothing changed, no
   * audit event written" from a real update. */
  changed: VolunteerHoursFlagDelta;
}

/**
 * Atomically updates any subset of the six volunteer-hours capability flags
 * and writes their audit event in the SAME database transaction — either
 * both commit or neither does. Concurrency-safe via the same
 * conditional-updateMany-plus-count-check idiom already used by
 * attemptClaimReportExport() (report-export-queue.ts) and
 * grantInternalOrganizationTrial()'s anti-stacking updateMany: the WHERE
 * clause pins each changed column to the value this call read as "before",
 * so a second concurrent call whose write lands after this one's commit
 * will see the NEW value at write time (Postgres serializes the two
 * UPDATE statements on the same row) and its own predicate will no longer
 * match, failing with PTA_VOLUNTEER_HOURS_FLAGS_CONCURRENT_CONFLICT rather
 * than silently overwriting or producing a misleading before/after pair.
 *
 * Every unrelated PtaProfile column is left completely untouched — this
 * function never does a full-row upsert, only a targeted update of exactly
 * the columns being changed.
 */
export async function updatePtaVolunteerHoursFlags(
  input: UpdatePtaVolunteerHoursFlagsInput
): Promise<UpdatePtaVolunteerHoursFlagsResult> {
  if (!input.actorUserId) {
    throw new PtaError("PTA_VALIDATION_ERROR", "An authenticated actor is required to change volunteer-hours settings.");
  }
  // Defense-in-depth: the route already checks this before calling here, but
  // this function must never be safely callable by some future caller that
  // forgets to — matches guard.ts's own "checked before any role/permission
  // check" philosophy for this feature.
  if (!isPtaVolunteerHoursPlatformEnabled()) {
    throw new PtaError("PTA_VOLUNTEER_HOURS_PLATFORM_DISABLED", "Volunteer hour requirements are not available on this platform.");
  }
  if (!isPtaVolunteerHoursOrgAllowed(input.organizationId)) {
    throw new PtaError("PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED", "Volunteer hour requirements are not available on this platform.");
  }

  const requestedKeys = VOLUNTEER_HOURS_FLAG_KEYS.filter((key) => input.changes[key] !== undefined);
  if (requestedKeys.length === 0) {
    const profile = await prisma.ptaProfile.findUnique({ where: { organizationId: input.organizationId } });
    if (!profile) throw new PtaError("PTA_PROFILE_NOT_FOUND", "PTA profile not found.");
    return { profile, changed: {} };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.ptaProfile.findUnique({ where: { organizationId: input.organizationId } });
    if (!existing) throw new PtaError("PTA_PROFILE_NOT_FOUND", "PTA profile not found.");

    const changed: VolunteerHoursFlagDelta = {};
    for (const key of requestedKeys) {
      const after = input.changes[key] as boolean;
      const before = existing[key];
      if (before !== after) changed[key] = { before, after };
    }

    // True no-op: every requested value already matches the current row.
    // No write, no audit event — an unaudited "nothing happened" is correct,
    // not a gap, since nothing did happen.
    if (Object.keys(changed).length === 0) {
      return { profile: existing, changed: {} };
    }

    const whereGuard: Record<string, string | boolean> = { organizationId: input.organizationId };
    const data: Record<string, boolean> = {};
    for (const key of Object.keys(changed) as VolunteerHoursFlagKey[]) {
      whereGuard[key] = changed[key]!.before;
      data[key] = changed[key]!.after;
    }

    const result = await tx.ptaProfile.updateMany({
      where: whereGuard as Prisma.PtaProfileWhereInput,
      data: data as Prisma.PtaProfileUpdateManyMutationInput,
    });
    if (result.count !== 1) {
      throw new PtaError(
        "PTA_VOLUNTEER_HOURS_FLAGS_CONCURRENT_CONFLICT",
        "These settings were changed by someone else at the same time. Reload and try again."
      );
    }

    await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail ?? null,
      action: "pta.volunteer_hours.flags_changed",
      entityType: "pta_profile",
      entityId: existing.id,
      metadata: changed,
      tx,
    });

    const profile = await tx.ptaProfile.findUnique({ where: { organizationId: input.organizationId } });
    return { profile: profile!, changed };
  });
}
