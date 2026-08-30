import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { PtaError } from "../errors";
import { getVolunteerRequirementPeriod } from "./periods";
import { formatOrgWallTime, resolveOrgWallTimeToUtc } from "./timezone";

/**
 * feature/pta-family-agreement-buyout. This entire module implements an
 * ACKNOWLEDGMENT — "an authorized adult in a PTA household electronically
 * acknowledges a versioned PTA Volunteer Commitment Agreement on behalf of
 * the household" — never marketed or treated internally as a certified
 * electronic signature. No identity verification and no e-signature
 * compliance framework (eIDAS/ESIGN-Act-grade audit trail, notarization,
 * etc.) backs any record this module creates. See
 * docs/pta-family-agreement-buyout.md for the full framing rationale.
 */

/** Bump only if the checkbox/acknowledgment COPY itself materially changes
 * — distinct from an agreement VERSION's own versionNumber, which tracks
 * the agreement CONTENT. Mirrors VOLUNTEER_HOURS_ACK_VERSION's pattern. */
export const PTA_FAMILY_AGREEMENT_ACK_VERSION = "2026-08-30.1";

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 50_000;

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Plain text only — never rendered via dangerouslySetInnerHTML anywhere in
 * this feature (React's default JSX text interpolation escapes it), so no
 * HTML sanitization library is needed for XSS purposes. This validation
 * exists to reject obviously-wrong input (empty, absurdly long, or
 * containing raw control characters that would corrupt xlsx/PDF export
 * later), not to permit any markup. */
function validateAgreementContent(title: string, content: string) {
  const trimmedTitle = title.trim();
  const trimmedContent = content.trim();
  if (!trimmedTitle) throw new PtaError("PTA_VALIDATION_ERROR", "The agreement needs a title.");
  if (trimmedTitle.length > MAX_TITLE_LENGTH) throw new PtaError("PTA_VALIDATION_ERROR", `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`);
  if (!trimmedContent) throw new PtaError("PTA_VALIDATION_ERROR", "The agreement needs content.");
  if (trimmedContent.length > MAX_CONTENT_LENGTH) throw new PtaError("PTA_VALIDATION_ERROR", `Content must be ${MAX_CONTENT_LENGTH} characters or fewer.`);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(trimmedContent)) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Content contains unsupported control characters.");
  }
  return { title: trimmedTitle, content: trimmedContent };
}

export async function listAgreementVersions(organizationId: string, periodId: string) {
  await getVolunteerRequirementPeriod(organizationId, periodId);
  return prisma.ptaVolunteerAgreementVersion.findMany({
    where: { organizationId, requirementPeriodId: periodId },
    orderBy: { versionNumber: "desc" },
  });
}

export async function getAgreementVersion(organizationId: string, versionId: string) {
  const version = await prisma.ptaVolunteerAgreementVersion.findFirst({ where: { id: versionId, organizationId } });
  if (!version) throw new PtaError("PTA_VOLUNTEER_AGREEMENT_VERSION_NOT_FOUND", "Agreement version not found in this organization.");
  return version;
}

export interface CreateAgreementDraftInput {
  title: string;
  content: string;
  effectiveDate?: Date | null;
}

/** A period's versionNumber sequence is derived from the current max, not a
 * separate counter row — safe here because drafts are created one at a time
 * through this admin-only, RBAC-gated path (unlike the money-side
 * concurrency this program guards with real DB constraints elsewhere); a
 * genuine simultaneous double-create would at worst produce two versions
 * that both computed the same next number, which the unique constraint
 * below turns into a clean, retryable conflict rather than silent
 * corruption. */
export async function createAgreementDraft(
  organizationId: string,
  periodId: string,
  input: CreateAgreementDraftInput,
  actor: { userId: string; userEmail?: string | null }
) {
  await getVolunteerRequirementPeriod(organizationId, periodId);
  const { title, content } = validateAgreementContent(input.title, input.content);

  const last = await prisma.ptaVolunteerAgreementVersion.findFirst({
    where: { organizationId, requirementPeriodId: periodId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const versionNumber = (last?.versionNumber ?? 0) + 1;

  let draft;
  try {
    draft = await prisma.ptaVolunteerAgreementVersion.create({
      data: {
        organizationId,
        requirementPeriodId: periodId,
        title,
        versionNumber,
        content,
        contentHash: hashContent(content),
        status: "DRAFT",
        effectiveDate: input.effectiveDate ?? null,
        createdByUserId: actor.userId,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new PtaError("PTA_VALIDATION_ERROR", "Another version was just created — please retry.");
    }
    throw error;
  }

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.agreement_draft_created",
    entityType: "pta_volunteer_agreement_version",
    entityId: draft.id,
    metadata: { periodId, versionNumber },
  });

  return draft;
}

export interface UpdateAgreementDraftInput {
  title: string;
  content: string;
  effectiveDate?: Date | null;
}

/** Only a DRAFT may be edited — a PUBLISHED version's content/title/hash
 * are immutable from this point forward, enforced here (not just by
 * convention), matching "a published version's substantive content cannot
 * be edited." */
export async function updateAgreementDraft(
  organizationId: string,
  versionId: string,
  input: UpdateAgreementDraftInput,
  actor: { userId: string; userEmail?: string | null }
) {
  const existing = await getAgreementVersion(organizationId, versionId);
  if (existing.status !== "DRAFT") {
    throw new PtaError("PTA_VOLUNTEER_AGREEMENT_NOT_DRAFT", "Only a draft agreement version can be edited. Create a new version instead.");
  }
  const { title, content } = validateAgreementContent(input.title, input.content);

  const updated = await prisma.ptaVolunteerAgreementVersion.update({
    where: { id: versionId },
    data: { title, content, contentHash: hashContent(content), effectiveDate: input.effectiveDate ?? null },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.agreement_draft_updated",
    entityType: "pta_volunteer_agreement_version",
    entityId: updated.id,
    metadata: { periodId: updated.requirementPeriodId },
  });

  return updated;
}

/** Publish is a one-way transition (DRAFT -> PUBLISHED). Snapshots
 * publishedAt/publishedByUserId; content/contentHash are already final at
 * this point since only a DRAFT could have been edited. */
export async function publishAgreementVersion(organizationId: string, versionId: string, actor: { userId: string; userEmail?: string | null }) {
  const existing = await getAgreementVersion(organizationId, versionId);
  if (existing.status !== "DRAFT") {
    throw new PtaError("PTA_VOLUNTEER_AGREEMENT_NOT_DRAFT", "Only a draft agreement version can be published.");
  }

  const published = await prisma.ptaVolunteerAgreementVersion.update({
    where: { id: versionId },
    data: { status: "PUBLISHED", publishedAt: new Date(), publishedByUserId: actor.userId },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.agreement_published",
    entityType: "pta_volunteer_agreement_version",
    entityId: published.id,
    metadata: { periodId: published.requirementPeriodId, versionNumber: published.versionNumber, contentHash: published.contentHash },
  });

  return published;
}

/** Archiving never deletes anything — it only marks a version as no longer
 * assignable to a period going forward. A period currently pointing at this
 * version via `assignedAgreementVersion` keeps pointing at it (archiving
 * does not auto-unassign); an admin must explicitly reassign if that's what
 * they want (see docs section 10's amendment policy). Existing acceptances
 * of an archived version remain fully valid and remain visible to the
 * household that made them. */
export async function archiveAgreementVersion(organizationId: string, versionId: string, actor: { userId: string; userEmail?: string | null }) {
  const existing = await getAgreementVersion(organizationId, versionId);
  if (existing.status === "ARCHIVED") return existing;
  if (existing.status === "DRAFT") {
    throw new PtaError("PTA_VALIDATION_ERROR", "A draft can be edited or left as-is — there's nothing to archive until it's published.");
  }

  const archived = await prisma.ptaVolunteerAgreementVersion.update({
    where: { id: versionId },
    data: { status: "ARCHIVED", archivedAt: new Date(), archivedByUserId: actor.userId },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.agreement_archived",
    entityType: "pta_volunteer_agreement_version",
    entityId: archived.id,
    metadata: { periodId: archived.requirementPeriodId },
  });

  return archived;
}

export interface AgreementPolicyInput {
  agreementRequired: boolean;
  agreementVersionId: string | null;
  contractLinkedBuyoutEnabled: boolean;
  contractLinkedEligibilityDays: number | null;
  contractLinkedUsesAcceptanceRate: boolean;
}

/**
 * The one write path for every agreement/contract-linked-buyout POLICY
 * field on a period — never patched piecemeal by other code, so this
 * function is the single place that enforces internal consistency (e.g. a
 * period can't require an agreement without designating WHICH published
 * version satisfies it). Atomic: the update and its audit event commit in
 * the same transaction (see createAuditEvent's own transactional contract,
 * matching this program's `flags-concurrency` precedent) — a failed audit
 * insert must roll back the policy change, never leave one without the
 * other.
 */
export async function updateAgreementPolicy(
  organizationId: string,
  periodId: string,
  input: AgreementPolicyInput,
  actor: { userId: string; userEmail?: string | null }
) {
  const period = await getVolunteerRequirementPeriod(organizationId, periodId);

  if (input.agreementRequired && !input.agreementVersionId) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Choose which published agreement version is required before enabling this.");
  }
  if (input.contractLinkedBuyoutEnabled && !input.agreementVersionId) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Contract-linked buyout needs an assigned agreement version.");
  }
  if (input.contractLinkedBuyoutEnabled && (!input.contractLinkedEligibilityDays || input.contractLinkedEligibilityDays <= 0)) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Set how many days after acceptance the contract-linked offer stays open.");
  }

  let assignedVersion: { id: string; status: string; requirementPeriodId: string } | null = null;
  if (input.agreementVersionId) {
    const version = await prisma.ptaVolunteerAgreementVersion.findFirst({
      where: { id: input.agreementVersionId, organizationId },
      select: { id: true, status: true, requirementPeriodId: true },
    });
    if (!version) throw new PtaError("PTA_VOLUNTEER_AGREEMENT_VERSION_NOT_FOUND", "Agreement version not found in this organization.");
    if (version.requirementPeriodId !== periodId) {
      throw new PtaError("PTA_VALIDATION_ERROR", "That agreement version belongs to a different requirement period.");
    }
    if (version.status !== "PUBLISHED") {
      throw new PtaError("PTA_VALIDATION_ERROR", "Only a published agreement version can be assigned to a period.");
    }
    assignedVersion = version;
  }

  const before = {
    agreementRequired: period.agreementRequired,
    agreementVersionId: period.agreementVersionId,
    contractLinkedBuyoutEnabled: period.contractLinkedBuyoutEnabled,
    contractLinkedEligibilityDays: period.contractLinkedEligibilityDays,
    contractLinkedUsesAcceptanceRate: period.contractLinkedUsesAcceptanceRate,
  };

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.ptaVolunteerRequirementPeriod.update({
      where: { id: periodId },
      data: {
        agreementRequired: input.agreementRequired,
        agreementVersionId: assignedVersion?.id ?? null,
        contractLinkedBuyoutEnabled: input.contractLinkedBuyoutEnabled,
        contractLinkedEligibilityDays: input.contractLinkedEligibilityDays,
        contractLinkedUsesAcceptanceRate: input.contractLinkedUsesAcceptanceRate,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: actor.userId,
      actorEmail: actor.userEmail ?? null,
      action: "pta.volunteer_hours.agreement_policy_updated",
      entityType: "pta_volunteer_requirement_period",
      entityId: periodId,
      metadata: { before, after: input } as unknown as Prisma.InputJsonValue,
      tx,
    });

    return row;
  });

  return updated;
}

export interface HouseholdAgreementStatus {
  required: boolean;
  assignedVersion: Awaited<ReturnType<typeof getAgreementVersion>> | null;
  acceptance: Awaited<ReturnType<typeof findHouseholdAcceptance>> | null;
  contractLinkedBuyoutEnabled: boolean;
  /** Null when not accepted, not contract-linked-enabled, or the
   * household's acceptance isn't for the CURRENTLY assigned version. */
  contractLinkedEligibleUntil: Date | null;
  contractLinkedEligibleNow: boolean;
}

async function findHouseholdAcceptance(organizationId: string, householdId: string, agreementVersionId: string) {
  return prisma.ptaVolunteerAgreementAcceptance.findUnique({
    where: { organizationId_householdId_agreementVersionId: { organizationId, householdId, agreementVersionId } },
  });
}

/** The single read path both the family UI and the admin per-household
 * status view use — on-screen JSON and any future export can never diverge
 * on "is this household eligible," the same anti-divergence discipline the
 * reporting architecture already uses for dollar figures. */
export async function resolveHouseholdAgreementStatus(
  organizationId: string,
  periodId: string,
  householdId: string,
  now: Date = new Date()
): Promise<HouseholdAgreementStatus> {
  const period = await getVolunteerRequirementPeriod(organizationId, periodId);

  if (!period.agreementVersionId) {
    return {
      required: period.agreementRequired,
      assignedVersion: null,
      acceptance: null,
      contractLinkedBuyoutEnabled: false,
      contractLinkedEligibleUntil: null,
      contractLinkedEligibleNow: false,
    };
  }

  const assignedVersion = await getAgreementVersion(organizationId, period.agreementVersionId);
  const acceptance = await findHouseholdAcceptance(organizationId, householdId, assignedVersion.id);

  let contractLinkedEligibleUntil: Date | null = null;
  if (acceptance && period.contractLinkedBuyoutEnabled && period.contractLinkedEligibilityDays) {
    contractLinkedEligibleUntil = new Date(acceptance.acceptedAt.getTime() + period.contractLinkedEligibilityDays * 24 * 60 * 60 * 1000);
  }
  const contractLinkedEligibleNow = contractLinkedEligibleUntil !== null && now < contractLinkedEligibleUntil;

  return {
    required: period.agreementRequired,
    assignedVersion,
    acceptance,
    contractLinkedBuyoutEnabled: period.contractLinkedBuyoutEnabled,
    contractLinkedEligibleUntil,
    contractLinkedEligibleNow,
  };
}

export interface AcceptAgreementInput {
  typedName?: string | null;
  acknowledged: boolean;
}

/**
 * Idempotent: a repeated submission for the SAME household+version returns
 * the EXISTING acceptance rather than erroring or creating a duplicate —
 * enforced at the database level by the unique constraint on
 * (organizationId, householdId, agreementVersionId), not merely a
 * check-then-insert (see the P2002 catch below; the real-Postgres
 * concurrency test proves this holds under genuinely simultaneous
 * submissions, mirroring RV-2/RV-9's exact discipline). `acceptedAt` is
 * always `new Date()` computed HERE, server-side — never accepted from the
 * request body, so it can be neither spoofed nor backdated.
 */
export async function acceptAgreement(
  organizationId: string,
  periodId: string,
  householdId: string,
  input: AcceptAgreementInput,
  actor: { userId: string; adultId: string }
) {
  if (!input.acknowledged) {
    throw new PtaError("PTA_VALIDATION_ERROR", "You must acknowledge the agreement before continuing.");
  }
  const period = await getVolunteerRequirementPeriod(organizationId, periodId);
  if (!period.agreementVersionId) {
    throw new PtaError("PTA_VOLUNTEER_AGREEMENT_NOT_ASSIGNED", "No agreement is currently assigned to this requirement period.");
  }
  const version = await getAgreementVersion(organizationId, period.agreementVersionId);
  if (version.status !== "PUBLISHED") {
    throw new PtaError("PTA_VOLUNTEER_AGREEMENT_NOT_ASSIGNED", "The assigned agreement version is not currently published.");
  }

  const existing = await findHouseholdAcceptance(organizationId, householdId, version.id);
  if (existing) return existing;

  const acceptedAt = new Date();
  let acceptance;
  try {
    acceptance = await prisma.$transaction(async (tx) => {
      const row = await tx.ptaVolunteerAgreementAcceptance.create({
        data: {
          organizationId,
          requirementPeriodId: periodId,
          agreementVersionId: version.id,
          householdId,
          acceptedByUserId: actor.userId,
          acceptedByAdultId: actor.adultId,
          acceptedAt,
          contentHashAtAcceptance: version.contentHash,
          ackVersion: PTA_FAMILY_AGREEMENT_ACK_VERSION,
          typedName: input.typedName?.trim() || null,
        },
      });

      await createAuditEvent({
        organizationId,
        actorUserId: actor.userId,
        action: "pta.volunteer_hours.agreement_accepted",
        entityType: "pta_volunteer_agreement_acceptance",
        entityId: row.id,
        metadata: { periodId, agreementVersionId: version.id, householdId },
        tx,
      });

      return row;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Lost a genuine concurrent race -- some other request's insert for
      // the SAME household+version won. Return the winner's row rather
      // than erroring: a repeated submission must behave identically to
      // this call having simply been the second (harmless) one.
      const winner = await findHouseholdAcceptance(organizationId, householdId, version.id);
      if (winner) return winner;
    }
    throw error;
  }

  return acceptance;
}

export interface AgreementStatusCounts {
  notYetAccepted: number;
  accepted: number;
  offerWindowOpen: number;
  offerWindowExpired: number;
  volunteerElection: number;
  partialBuyoutElection: number;
  fullBuyoutElection: number;
}

/** Admin dashboard counts (section 7) — one pass over every household with
 * ANY volunteer-hours footprint in this period (assignment, election, or
 * acceptance), never trusting client-supplied aggregates. */
export async function getAgreementStatusCounts(organizationId: string, periodId: string, now: Date = new Date()): Promise<AgreementStatusCounts> {
  const period = await getVolunteerRequirementPeriod(organizationId, periodId);

  const householdIds = new Set<string>();
  const [assignments, elections] = await Promise.all([
    prisma.ptaVolunteerRequirementAssignment.findMany({ where: { organizationId, periodId }, select: { householdId: true } }),
    prisma.ptaVolunteerBuyoutElection.findMany({
      where: { organizationId, requirementPeriodId: periodId },
      orderBy: { createdAt: "desc" },
      select: { householdId: true, electionType: true, createdAt: true },
    }),
  ]);
  for (const a of assignments) if (a.householdId) householdIds.add(a.householdId);
  for (const e of elections) householdIds.add(e.householdId);

  const latestElectionByHousehold = new Map<string, (typeof elections)[number]>();
  for (const e of elections) {
    if (!latestElectionByHousehold.has(e.householdId)) latestElectionByHousehold.set(e.householdId, e);
  }

  const acceptances = period.agreementVersionId
    ? await prisma.ptaVolunteerAgreementAcceptance.findMany({
        where: { organizationId, agreementVersionId: period.agreementVersionId },
        select: { householdId: true, acceptedAt: true },
      })
    : [];
  const acceptanceByHousehold = new Map(acceptances.map((a) => [a.householdId, a]));
  for (const a of acceptances) householdIds.add(a.householdId);

  const counts: AgreementStatusCounts = {
    notYetAccepted: 0,
    accepted: 0,
    offerWindowOpen: 0,
    offerWindowExpired: 0,
    volunteerElection: 0,
    partialBuyoutElection: 0,
    fullBuyoutElection: 0,
  };

  for (const householdId of householdIds) {
    const acceptance = acceptanceByHousehold.get(householdId);
    if (acceptance) {
      counts.accepted += 1;
      if (period.contractLinkedBuyoutEnabled && period.contractLinkedEligibilityDays) {
        const until = new Date(acceptance.acceptedAt.getTime() + period.contractLinkedEligibilityDays * 24 * 60 * 60 * 1000);
        if (now < until) counts.offerWindowOpen += 1;
        else counts.offerWindowExpired += 1;
      }
    } else {
      counts.notYetAccepted += 1;
    }

    const latest = latestElectionByHousehold.get(householdId);
    if (latest?.electionType === "VOLUNTEER") counts.volunteerElection += 1;
    else if (latest?.electionType === "PARTIAL_BUYOUT") counts.partialBuyoutElection += 1;
    else if (latest?.electionType === "FULL_BUYOUT") counts.fullBuyoutElection += 1;
  }

  return counts;
}

/** Pure formatting helper for the admin UI — the offer-expiration instant
 * displayed in the organization's own timezone (never the browser's),
 * matching every other date this program shows an admin. */
export function formatContractLinkedOfferExpiration(eligibleUntil: Date, timezone: string): string {
  return formatOrgWallTime(eligibleUntil.toISOString(), timezone, true);
}

// Re-exported so route/UI layers never need to import timezone.ts directly
// just to resolve an admin-typed date for this feature.
export { resolveOrgWallTimeToUtc };

export type AgreementNotificationType = "AGREEMENT_AVAILABLE" | "AGREEMENT_REMINDER" | "AGREEMENT_ACCEPTED_CONFIRMATION" | "CONTRACT_OFFER_EXPIRING";

/**
 * feature/pta-family-agreement-buyout, FA-8. Preview/test-send ONLY —
 * mirrors notifications.ts's `previewVolunteerHoursNotification` exactly
 * (same "[TEST]" subject convention, same audit event, same requirement
 * that the requirements capability be on). Deliberately does NOT log to
 * PtaVolunteerNotificationLog (that table's dedup semantics are for a REAL
 * automated sweep, which does not exist for this feature yet — see docs)
 * and is never called from any cron/worker path; this is the only function
 * in this whole file that can send an email, and it can only ever send to
 * an admin-supplied test address, never to a real family.
 */
export async function previewAgreementNotification(
  organizationId: string,
  periodId: string,
  notificationType: AgreementNotificationType,
  testRecipientEmail: string,
  actor: { userId: string; userEmail: string }
): Promise<void> {
  const period = await getVolunteerRequirementPeriod(organizationId, periodId);
  const email = testRecipientEmail.trim();
  if (!email) throw new PtaError("PTA_VALIDATION_ERROR", "A test recipient email is required.");

  const subjectByType: Record<AgreementNotificationType, string> = {
    AGREEMENT_AVAILABLE: `[TEST] A volunteer commitment agreement is ready to review — ${period.name}`,
    AGREEMENT_REMINDER: `[TEST] Reminder: please accept your volunteer commitment agreement — ${period.name}`,
    AGREEMENT_ACCEPTED_CONFIRMATION: `[TEST] Your volunteer commitment agreement was accepted — ${period.name}`,
    CONTRACT_OFFER_EXPIRING: `[TEST] Your contract-linked buyout offer is expiring soon — ${period.name}`,
  };

  await sendEmail({
    to: email,
    subject: subjectByType[notificationType],
    text: [
      "This is a TEST notification sent by an administrator previewing the volunteer-agreement notification templates.",
      "No real family received this message, and no real acceptance or obligation exists.",
      "",
      `Notification type: ${notificationType}`,
      `Requirement period: ${period.name}`,
    ].join("\n"),
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "pta.volunteer_hours.agreement_notification_previewed",
    entityType: "pta_volunteer_requirement_period",
    entityId: periodId,
    metadata: { notificationType, testRecipientEmail: email },
  });
}
