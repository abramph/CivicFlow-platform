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
