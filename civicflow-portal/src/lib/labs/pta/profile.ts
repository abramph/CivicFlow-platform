import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { PtaError } from "./errors";
import { resolveSchoolYearId } from "./school-years";

export async function getPtaProfile(organizationId: string) {
  return prisma.ptaProfile.findUnique({ where: { organizationId } });
}

export interface UpsertPtaProfileInput {
  organizationId: string;
  schoolOrPtaName: string;
  designation?: "PTA" | "PTO";
  currentSchoolYear: string;
  schoolAddress?: string | null;
  schoolWebsite?: string | null;
  principalName?: string | null;
  contactEmail?: string | null;
  membershipModel?: "INDIVIDUAL" | "HOUSEHOLD" | "FAMILY";
  defaultDuesAmountCents?: number | null;
  gradesServed?: string[];
  /** PTA-E: feature switch + display name for Concerns & Grievances. Only
   * applied when explicitly provided — an unrelated profile save must never
   * silently re-enable a disabled concerns module. */
  concernsEnabled?: boolean;
  concernsLabel?: string | null;
  /** PTA-L: elections stay dark until deliberately enabled (default false). */
  electionsEnabled?: boolean;
  /** Volunteer Hour Requirements & Buyout program (docs/pta-volunteer-hours.md).
   * Six independent flags, all dark until deliberately enabled — none imply
   * any of the others. Also gated by the platform-wide env kill-switch
   * (isPtaVolunteerHoursPlatformEnabled), checked separately by guards. */
  ptaVolunteerRequirementsEnabled?: boolean;
  ptaVolunteerBuyoutEnabled?: boolean;
  ptaVolunteerAssessmentsEnabled?: boolean;
  ptaVolunteerReportsEnabled?: boolean;
  ptaVolunteerNotificationsEnabled?: boolean;
  ptaVolunteerNativeMobileEnabled?: boolean;
  actorUserId: string;
  actorEmail?: string | null;
}

/** Explicitly not auto-created on Labs enrollment — an officer configures it after enrolling, same pattern as Meeting Intelligence's "no schema change auto-enables anything." */
export async function upsertPtaProfile(input: UpsertPtaProfileInput) {
  if (!input.schoolOrPtaName.trim()) throw new PtaError("PTA_VALIDATION_ERROR", "School or PTA name is required.");
  if (!input.currentSchoolYear.trim()) throw new PtaError("PTA_VALIDATION_ERROR", "Current school year is required.");

  const data = {
    schoolOrPtaName: input.schoolOrPtaName,
    designation: input.designation ?? "PTA",
    currentSchoolYear: input.currentSchoolYear,
    schoolAddress: input.schoolAddress ?? null,
    schoolWebsite: input.schoolWebsite ?? null,
    principalName: input.principalName ?? null,
    contactEmail: input.contactEmail ?? null,
    membershipModel: input.membershipModel ?? "HOUSEHOLD",
    defaultDuesAmountCents: input.defaultDuesAmountCents ?? null,
    gradesServed: input.gradesServed ?? [],
    ...(input.concernsEnabled !== undefined ? { concernsEnabled: input.concernsEnabled } : {}),
    ...(input.concernsLabel !== undefined ? { concernsLabel: input.concernsLabel?.trim() || null } : {}),
    ...(input.electionsEnabled !== undefined ? { electionsEnabled: input.electionsEnabled } : {}),
    ...(input.ptaVolunteerRequirementsEnabled !== undefined
      ? { ptaVolunteerRequirementsEnabled: input.ptaVolunteerRequirementsEnabled }
      : {}),
    ...(input.ptaVolunteerBuyoutEnabled !== undefined ? { ptaVolunteerBuyoutEnabled: input.ptaVolunteerBuyoutEnabled } : {}),
    ...(input.ptaVolunteerAssessmentsEnabled !== undefined
      ? { ptaVolunteerAssessmentsEnabled: input.ptaVolunteerAssessmentsEnabled }
      : {}),
    ...(input.ptaVolunteerReportsEnabled !== undefined ? { ptaVolunteerReportsEnabled: input.ptaVolunteerReportsEnabled } : {}),
    ...(input.ptaVolunteerNotificationsEnabled !== undefined
      ? { ptaVolunteerNotificationsEnabled: input.ptaVolunteerNotificationsEnabled }
      : {}),
    ...(input.ptaVolunteerNativeMobileEnabled !== undefined
      ? { ptaVolunteerNativeMobileEnabled: input.ptaVolunteerNativeMobileEnabled }
      : {}),
  } as const;

  const existing = await prisma.ptaProfile.findUnique({ where: { organizationId: input.organizationId } });
  const profile = await prisma.ptaProfile.upsert({
    where: { organizationId: input.organizationId },
    create: { organizationId: input.organizationId, ...data },
    update: data,
  });

  // Volunteer-hours flags gate money and communications, not just visibility
  // — always give the audit trail an explicit before/after for these six,
  // regardless of whether anything else on the profile changed.
  const volunteerFlagKeys = [
    "ptaVolunteerRequirementsEnabled",
    "ptaVolunteerBuyoutEnabled",
    "ptaVolunteerAssessmentsEnabled",
    "ptaVolunteerReportsEnabled",
    "ptaVolunteerNotificationsEnabled",
    "ptaVolunteerNativeMobileEnabled",
  ] as const;
  const flagChanges: Record<string, { before: boolean; after: boolean }> = {};
  for (const key of volunteerFlagKeys) {
    if (input[key] !== undefined && existing && existing[key] !== profile[key]) {
      flagChanges[key] = { before: existing[key], after: profile[key] };
    }
  }
  if (Object.keys(flagChanges).length > 0) {
    await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail ?? null,
      action: "pta.volunteer_hours.flags_changed",
      entityType: "pta_profile",
      entityId: profile.id,
      metadata: flagChanges,
    });
  }

  // PTA-A school-year normalization: the profile label and the PtaSchoolYear
  // entity must never disagree about which year is current. Whichever side is
  // edited, the other follows — school-years.ts's setCurrentSchoolYear()
  // writes this label; here the label write flips the entity.
  const currentYearId = await resolveSchoolYearId(input.organizationId, input.currentSchoolYear);
  if (currentYearId) {
    await prisma.$transaction([
      prisma.ptaSchoolYear.updateMany({
        where: { organizationId: input.organizationId, isCurrent: true, id: { not: currentYearId } },
        data: { isCurrent: false },
      }),
      prisma.ptaSchoolYear.update({ where: { id: currentYearId }, data: { isCurrent: true } }),
    ]);
  }

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: existing ? "pta.profile.updated" : "pta.profile.created",
    entityType: "pta_profile",
    entityId: profile.id,
    metadata: { currentSchoolYear: input.currentSchoolYear },
  });

  return profile;
}
