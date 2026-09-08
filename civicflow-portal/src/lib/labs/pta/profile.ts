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
  /** Academic-year student progression stays dark until deliberately
   * enabled (default false) — also requires the platform kill-switch to be
   * on; see isPtaStudentProgressionPlatformEnabled. */
  studentProgressionEnabled?: boolean;
  /** fix/pta-volunteer-settings-atomic-audit: the six volunteer-hours
   * capability flags are deliberately NOT accepted here anymore. They used
   * to be written by this function's own upsert() with their audit event
   * fired as a separate, non-transactional statement afterward — which let
   * the flag change commit while the audit insert failed independently
   * (see docs/pta-volunteer-hours.md's audit-atomicity note). The only
   * supported way to change any of them is now
   * updatePtaVolunteerHoursFlags() (volunteer-hours/flags.ts), which updates
   * the flag and writes its audit event in one transaction. Removing these
   * fields from this interface means any new caller that types out an
   * UpsertPtaProfileInput object literal including one of them gets a
   * compile error; a caller that spreads an object which happens to still
   * carry these properties (e.g. a wider zod-parsed body) has them silently
   * ignored here, same as any other untyped extra field — the real
   * guarantee is that this function's own `data` builder below never reads
   * or writes any of the six columns, under any input shape. */
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
    ...(input.studentProgressionEnabled !== undefined ? { studentProgressionEnabled: input.studentProgressionEnabled } : {}),
  } as const;

  const existing = await prisma.ptaProfile.findUnique({ where: { organizationId: input.organizationId } });
  const profile = await prisma.ptaProfile.upsert({
    where: { organizationId: input.organizationId },
    create: { organizationId: input.organizationId, ...data },
    update: data,
  });

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
