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
 * assignable to a period going forward. Existing acceptances of an archived
 * version remain fully valid and remain visible to the household that made
 * them (see docs section 10's amendment policy).
 *
 * FA2 §5: a version that is the period's CURRENT `agreementVersionId` while
 * `agreementRequired` is true cannot simply be archived out from under
 * families who are actively being asked to accept it — that would silently
 * strand the requirement pointing at a version no longer assignable, with
 * no UI path to even view it as "the" agreement going forward. Archiving
 * such a version requires `replacementVersionId`: a different, PUBLISHED
 * version belonging to the SAME period, atomically swapped in via the exact
 * same transaction that archives the old one (reusing
 * updateAgreementPolicy's own validation, not a second copy of it) — so a
 * period is never observably left with `agreementRequired=true` and an
 * ARCHIVED `agreementVersionId`, not even for one intermediate read. A
 * version that is merely assigned-but-not-required, or not the CURRENT
 * assignment at all, archives immediately with no replacement needed. */
export async function archiveAgreementVersion(
  organizationId: string,
  versionId: string,
  actor: { userId: string; userEmail?: string | null },
  replacementVersionId?: string
) {
  const existing = await getAgreementVersion(organizationId, versionId);
  if (existing.status === "ARCHIVED") return existing;
  if (existing.status === "DRAFT") {
    throw new PtaError("PTA_VALIDATION_ERROR", "A draft can be edited or left as-is — there's nothing to archive until it's published.");
  }

  const period = await getVolunteerRequirementPeriod(organizationId, existing.requirementPeriodId);
  const isActivelyRequired = period.agreementRequired && period.agreementVersionId === versionId;

  if (isActivelyRequired && !replacementVersionId) {
    throw new PtaError(
      "PTA_VOLUNTEER_AGREEMENT_ACTIVELY_REQUIRED",
      "This version is currently required by its period. Assign a replacement published version before archiving it."
    );
  }

  let replacement: { id: string; status: string; requirementPeriodId: string } | null = null;
  if (isActivelyRequired && replacementVersionId) {
    if (replacementVersionId === versionId) {
      throw new PtaError("PTA_VALIDATION_ERROR", "The replacement must be a different agreement version.");
    }
    replacement = await prisma.ptaVolunteerAgreementVersion.findFirst({
      where: { id: replacementVersionId, organizationId },
      select: { id: true, status: true, requirementPeriodId: true },
    });
    if (!replacement) throw new PtaError("PTA_VOLUNTEER_AGREEMENT_VERSION_NOT_FOUND", "Replacement agreement version not found in this organization.");
    if (replacement.requirementPeriodId !== existing.requirementPeriodId) {
      throw new PtaError("PTA_VALIDATION_ERROR", "The replacement version must belong to the same requirement period.");
    }
    if (replacement.status !== "PUBLISHED") {
      throw new PtaError("PTA_VALIDATION_ERROR", "Only a published agreement version can replace the currently required one.");
    }
  }

  const archived = await prisma.$transaction(async (tx) => {
    const row = await tx.ptaVolunteerAgreementVersion.update({
      where: { id: versionId },
      data: { status: "ARCHIVED", archivedAt: new Date(), archivedByUserId: actor.userId },
    });

    if (replacement) {
      await tx.ptaVolunteerRequirementPeriod.update({
        where: { id: existing.requirementPeriodId },
        data: { agreementVersionId: replacement.id },
      });
    }

    await createAuditEvent({
      organizationId,
      actorUserId: actor.userId,
      actorEmail: actor.userEmail ?? null,
      action: "pta.volunteer_hours.agreement_archived",
      entityType: "pta_volunteer_agreement_version",
      entityId: row.id,
      metadata: { periodId: row.requirementPeriodId, replacementVersionId: replacement?.id ?? null },
      tx,
    });

    return row;
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

  // FA2 §5: "a content-hash mismatch fails closed." Published content is
  // already structurally immutable (updateAgreementDraft refuses to touch
  // anything but a DRAFT), so acceptance.contentHashAtAcceptance and
  // assignedVersion.contentHash can only ever disagree here if something
  // bypassed the application layer entirely (a direct DB write). Rather
  // than silently returning a status a family or admin could read as
  // valid, this is the one place that actively checks the snapshot against
  // the live value and refuses to proceed — belt-and-suspenders made real,
  // not just documented.
  if (acceptance && acceptance.contentHashAtAcceptance !== assignedVersion.contentHash) {
    throw new PtaError(
      "PTA_VOLUNTEER_AGREEMENT_CONTENT_HASH_MISMATCH",
      "This household's recorded acceptance no longer matches the agreement's stored content. Contact support before relying on this status."
    );
  }

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
  // FA2 §5: "a period moved to ARCHIVED remains historically viewable but
  // cannot receive new acceptance." Reuses the exact error code
  // periods.ts's assertBuyoutWindowOpen already established for the
  // identical "this period isn't ACTIVE" condition, rather than inventing a
  // second one — a DRAFT or CLOSED period is blocked by the same check,
  // which is correct: only an ACTIVE period should ever accept a NEW
  // household acceptance. (An already-accepted household's EXISTING record
  // remains fully readable via resolveHouseholdAgreementStatus regardless
  // of period status — this check only guards the WRITE path.)
  if (period.status !== "ACTIVE") {
    throw new PtaError("PTA_VOLUNTEER_PERIOD_NOT_ACTIVE", "This requirement period isn't currently active.");
  }
  if (!period.agreementVersionId) {
    throw new PtaError("PTA_VOLUNTEER_AGREEMENT_NOT_ASSIGNED", "No agreement is currently assigned to this requirement period.");
  }
  const version = await getAgreementVersion(organizationId, period.agreementVersionId);
  if (version.status !== "PUBLISHED") {
    throw new PtaError("PTA_VOLUNTEER_AGREEMENT_NOT_ASSIGNED", "The assigned agreement version is not currently published.");
  }

  const existing = await findHouseholdAcceptance(organizationId, householdId, version.id);
  if (existing) return existing;

  // FA3 §1/§4, hardened FA4 §2: resolved and snapshotted BEFORE the write,
  // permanently — never re-derived on read. This is what actually makes
  // historical display survive the accepting adult's household-membership
  // being removed (acceptedByAdultId SetNulls) or their user account being
  // deleted (acceptedByUserId is a plain, non-FK string that simply goes
  // stale, same convention as audit events' actorId). The adult lookup is
  // expected to always succeed here — the accept route resolves adultId
  // via the same requireVolunteerHoursHouseholdAccess guard that created
  // it — a defensive fallback to the authenticated user's own
  // displayName/email exists for the case where the adult record is
  // somehow unresolvable, but there is deliberately NO further fallback
  // to a placeholder string beyond that: signerDisplayNameAtAcceptance is
  // historical evidence of who acknowledged the agreement, so if NEITHER
  // the adult record NOR the authenticated user yields a usable non-blank
  // name, the acceptance itself must fail rather than record a fabricated
  // or empty identity. Entirely server-derived — the client-supplied
  // AcceptAgreementInput has no field that could ever reach this column
  // (only typedName, a SEPARATE optional display field, is client-input).
  const signerAdult = await prisma.ptaHouseholdAdult.findUnique({
    where: { id: actor.adultId },
    select: { name: true, relationshipLabel: true },
  });
  let signerDisplayNameAtAcceptance = signerAdult?.name?.trim() || "";
  if (!signerDisplayNameAtAcceptance) {
    const fallbackUser = await prisma.user.findUnique({ where: { id: actor.userId }, select: { displayName: true, email: true } });
    signerDisplayNameAtAcceptance = fallbackUser?.displayName?.trim() || fallbackUser?.email?.trim() || "";
  }
  if (!signerDisplayNameAtAcceptance) {
    throw new PtaError(
      "PTA_VOLUNTEER_AGREEMENT_SIGNER_UNRESOLVED",
      "We couldn't identify who is accepting this agreement. Please add a name for this household adult before continuing."
    );
  }
  const signerRelationshipAtAcceptance = signerAdult?.relationshipLabel?.trim() || null;

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
          signerDisplayNameAtAcceptance,
          signerRelationshipAtAcceptance,
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

export interface AgreementNotificationRendered {
  subject: string;
  text: string;
}

const AGREEMENT_NOTIFICATION_SUBJECT_BY_TYPE: Record<AgreementNotificationType, (periodName: string) => string> = {
  AGREEMENT_AVAILABLE: (periodName) => `A volunteer commitment agreement is ready to review — ${periodName}`,
  AGREEMENT_REMINDER: (periodName) => `Reminder: please accept your volunteer commitment agreement — ${periodName}`,
  AGREEMENT_ACCEPTED_CONFIRMATION: (periodName) => `Your volunteer commitment agreement was accepted — ${periodName}`,
  CONTRACT_OFFER_EXPIRING: (periodName) => `Your contract-linked buyout offer is expiring soon — ${periodName}`,
};

function renderAgreementNotification(notificationType: AgreementNotificationType, periodName: string): AgreementNotificationRendered {
  return {
    subject: AGREEMENT_NOTIFICATION_SUBJECT_BY_TYPE[notificationType](periodName),
    text: [`Notification type: ${notificationType}`, `Requirement period: ${periodName}`].join("\n"),
  };
}

/**
 * feature/pta-family-agreement-buyout follow-up (FA3 §5): renders one of
 * the 4 agreement notification templates and returns the content — it
 * NEVER calls sendEmail. This is what makes it safe to gate on the
 * "requirements" capability alone (an admin must be able to see what these
 * templates say before ever deciding to turn the "notifications" flag on,
 * so gating preview behind that same flag would be circular) rather than
 * requiring "notifications" to be enabled. Previously this function and
 * the real send were the same operation (see git history) — that let a
 * "preview" call actually deliver an email to an arbitrary address without
 * the notifications flag ever being checked, which is exactly the gap this
 * split closes. Use sendTestAgreementNotification for an actual send.
 */
export async function previewAgreementNotification(
  organizationId: string,
  periodId: string,
  notificationType: AgreementNotificationType,
  actor: { userId: string; userEmail: string }
): Promise<AgreementNotificationRendered> {
  const period = await getVolunteerRequirementPeriod(organizationId, periodId);
  const rendered = renderAgreementNotification(notificationType, period.name);

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "pta.volunteer_hours.agreement_notification_previewed",
    entityType: "pta_volunteer_requirement_period",
    entityId: periodId,
    metadata: { notificationType },
  });

  return rendered;
}

/**
 * feature/pta-family-agreement-buyout follow-up (FA3 §5): the ONLY
 * function in this file that actually sends an email, and it can only
 * ever send to an admin-typed test address supplied directly in THIS
 * call — never a real household's contact details (no household is even
 * looked up here), never a batch, never called from any cron/worker path.
 * Deliberately does NOT log to PtaVolunteerNotificationLog (that table's
 * dedup semantics are for a REAL automated sweep, which does not exist for
 * this feature yet — see docs). Callers (the API route) are responsible
 * for requiring the "notifications" capability, a dedicated
 * notification-management permission, rate limiting, and a typed
 * confirmation BEFORE calling this — this function itself has no way to
 * know whether those were satisfied, same division of responsibility as
 * every other service function in this file trusting its route's guard.
 * The audit event is written AFTER the send attempt and always reflects
 * the real outcome (`delivered: false` on failure) — it must never claim
 * a delivery that didn't happen, and a failed send still re-throws so the
 * caller sees a real error rather than a false "ok".
 */
export async function sendTestAgreementNotification(
  organizationId: string,
  periodId: string,
  notificationType: AgreementNotificationType,
  testRecipientEmail: string,
  actor: { userId: string; userEmail: string }
): Promise<void> {
  const period = await getVolunteerRequirementPeriod(organizationId, periodId);
  const email = testRecipientEmail.trim();
  if (!email) throw new PtaError("PTA_VALIDATION_ERROR", "A test recipient email is required.");

  const rendered = renderAgreementNotification(notificationType, period.name);
  let sendError: unknown = null;
  try {
    await sendEmail({
      to: email,
      subject: `[TEST] ${rendered.subject}`,
      text: [
        "This is a TEST notification sent by an administrator testing the volunteer-agreement notification templates.",
        "No real family received this message, and no real acceptance or obligation exists.",
        "",
        rendered.text,
      ].join("\n"),
    });
  } catch (err) {
    sendError = err;
  }

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "pta.volunteer_hours.agreement_notification_test_sent",
    entityType: "pta_volunteer_requirement_period",
    entityId: periodId,
    metadata: { notificationType, testRecipientEmail: email, delivered: sendError === null },
  });

  if (sendError) throw sendError;
}
