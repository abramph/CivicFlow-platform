import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { applySubmission, type ApplySubmissionResult } from "./update-engine";
import { ALLOWED_MEMBER_TARGET_FIELDS, type AllowedMemberTargetField } from "./sensitivity";
import { MemberIntakeError } from "./errors";
import type { MemberIntakeFormField, MemberIntakeSubmissionStatus, OrgMember } from "@prisma/client";
import type { MemberMutationActor } from "@/lib/member-mutations";

/**
 * Member Intake & Profile Update (MEMBER-QR-G) — the admin review queue.
 * Read side (listSubmissions/getSubmissionDetail) is pure display: it never
 * mutates anything, only surfaces what matching.ts and submissions.ts already
 * decided plus a field-level diff for admin judgment. Write side
 * (approve/reject/linkToExisting/createNewAnyway) only ever moves a
 * REVIEW_REQUIRED (or, for approve, VERIFICATION_REQUIRED — see below)
 * submission into APPROVED/REJECTED via its own compare-and-swap, then hands
 * off to applySubmission() (update-engine.ts) for the actual member
 * create/update — never duplicates that logic or writes to OrgMember
 * directly here.
 *
 * Deliberately whole-submission, not per-field: update-engine.ts's own doc
 * comment already settled this ("simpler and safer than partial-apply for a
 * first milestone... still satisfies 'field-level diff' since the diff
 * itself is what the review queue will show"). G shows the diff; it doesn't
 * reopen that decision.
 */

export type SubmissionQueueFilter =
  | "ALL"
  | "NEEDS_VERIFICATION"
  | "NEEDS_REVIEW"
  | "POSSIBLE_DUPLICATES"
  | "NEW_MEMBERS"
  | "UPDATES"
  | "REJECTED";

const FILTER_WHERE: Record<SubmissionQueueFilter, Record<string, unknown>> = {
  ALL: {},
  NEEDS_VERIFICATION: { status: "VERIFICATION_REQUIRED" },
  NEEDS_REVIEW: { status: "REVIEW_REQUIRED" },
  POSSIBLE_DUPLICATES: { status: "REVIEW_REQUIRED", candidateMemberIds: { isEmpty: false } },
  NEW_MEMBERS: { createdMemberId: { not: null } },
  UPDATES: { matchedMemberId: { not: null }, appliedAt: { not: null } },
  REJECTED: { status: "REJECTED" },
};

export interface ListSubmissionsInput {
  formId?: string;
  filter?: SubmissionQueueFilter;
  take?: number;
  cursor?: string | null;
}

/** A short, human-readable submitter label for the queue list — pulled from
 * whatever identity-ish fields the submission happened to collect. Staff-only
 * surface (unlike the public routes), so showing this is fine — it is the
 * whole point of a review queue. */
function summarizeSubmitter(fieldValues: Record<string, unknown>): string {
  const name = [fieldValues.firstName, fieldValues.lastName].filter((v) => typeof v === "string" && v.trim()).join(" ");
  if (name) return name;
  const email = typeof fieldValues.email === "string" ? fieldValues.email : null;
  if (email) return email;
  const phone = typeof fieldValues.phone === "string" ? fieldValues.phone : null;
  if (phone) return phone;
  return "(no name provided)";
}

export async function listSubmissions(organizationId: string, input: ListSubmissionsInput = {}) {
  const filter = input.filter ?? "ALL";
  const take = Math.min(input.take ?? 50, 100);

  const rows = await prisma.memberIntakeSubmission.findMany({
    where: { organizationId, ...(input.formId ? { formId: input.formId } : {}), ...FILTER_WHERE[filter] },
    include: { form: { select: { id: true, name: true, purpose: true } }, source: { select: { id: true, name: true } } },
    orderBy: { submittedAt: "desc" },
    take: take + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return {
    submissions: page.map((row) => ({
      id: row.id,
      formId: row.form.id,
      formName: row.form.name,
      sourceName: row.source?.name ?? null,
      status: row.status,
      submittedAt: row.submittedAt,
      submitter: summarizeSubmitter(row.fieldValues as Record<string, unknown>),
      matchedMemberId: row.matchedMemberId,
      candidateCount: row.candidateMemberIds.length,
      matchConfidence: row.matchConfidence,
      matchMethod: row.matchMethod,
      verificationStatus: row.verificationStatus,
      appliedAt: row.appliedAt,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export interface MemberSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  membershipStatus: string;
}

function toMemberSummary(member: OrgMember): MemberSummary {
  return { id: member.id, firstName: member.firstName, lastName: member.lastName, email: member.email, phone: member.phone, membershipStatus: member.membershipStatus };
}

export interface FieldDiffEntry {
  fieldKey: string;
  label: string;
  targetField: AllowedMemberTargetField;
  sensitivity: "LOW" | "MODERATE" | "HIGH";
  previousValue: unknown;
  newValue: unknown;
  changed: boolean;
}

/** Same comparability rule update-engine.ts's applyUpdate uses (Date columns
 * compared via ISO string) — kept independent on purpose, see the file-level
 * doc comment: this is a read-only display computation, not the authorization
 * path, so it deliberately does not share code with the hardened apply-time
 * function. */
function diffAgainstMember(memberFields: MemberIntakeFormField[], fieldValues: Record<string, unknown>, member: OrgMember): FieldDiffEntry[] {
  return memberFields
    .filter((f): f is MemberIntakeFormField & { targetField: string } => f.targetField !== null && ALLOWED_MEMBER_TARGET_FIELDS.includes(f.targetField as AllowedMemberTargetField))
    .map((field) => {
      const submittedValue = fieldValues[field.fieldKey] ?? null;
      const currentValue = (member as unknown as Record<string, unknown>)[field.targetField];
      const currentComparable = currentValue instanceof Date ? currentValue.toISOString() : (currentValue ?? null);
      return {
        fieldKey: field.fieldKey,
        label: field.label,
        targetField: field.targetField as AllowedMemberTargetField,
        sensitivity: field.sensitivity,
        previousValue: currentComparable,
        newValue: submittedValue,
        changed: submittedValue !== null && JSON.stringify(currentComparable) !== JSON.stringify(submittedValue),
      };
    });
}

export interface SubmissionDetail {
  id: string;
  organizationId: string;
  formId: string;
  formName: string;
  status: MemberIntakeSubmissionStatus;
  submittedAt: Date;
  fieldValues: Record<string, unknown>;
  matchedMemberId: string | null;
  matchedMember: MemberSummary | null;
  candidateMembers: MemberSummary[];
  matchConfidence: number | null;
  matchMethod: string | null;
  verificationStatus: string;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  createdMemberId: string | null;
  appliedAt: Date | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  /** Diff against the matched member when there is one; otherwise diffed
   * against each candidate so an admin can compare before linking. Empty for
   * a confident NO_MATCH-style new-member submission. */
  diffByMemberId: Record<string, FieldDiffEntry[]>;
}

export async function getSubmissionDetail(organizationId: string, submissionId: string): Promise<SubmissionDetail> {
  const submission = await prisma.memberIntakeSubmission.findFirst({
    where: { id: submissionId, organizationId },
    include: { form: { include: { fields: true } } },
  });
  if (!submission) throw new MemberIntakeError("MEMBER_INTAKE_SUBMISSION_NOT_FOUND", "Submission not found.");

  const relevantMemberIds = Array.from(new Set([submission.matchedMemberId, ...submission.candidateMemberIds].filter((id): id is string => Boolean(id))));
  const members = relevantMemberIds.length
    ? await prisma.orgMember.findMany({ where: { id: { in: relevantMemberIds }, organizationId } })
    : [];
  const membersById = new Map(members.map((m) => [m.id, m]));

  const fieldValues = submission.fieldValues as Record<string, unknown>;
  const diffByMemberId: Record<string, FieldDiffEntry[]> = {};
  for (const member of members) {
    diffByMemberId[member.id] = diffAgainstMember(submission.form.fields, fieldValues, member);
  }

  return {
    id: submission.id,
    organizationId: submission.organizationId,
    formId: submission.formId,
    formName: submission.form.name,
    status: submission.status,
    submittedAt: submission.submittedAt,
    fieldValues,
    matchedMemberId: submission.matchedMemberId,
    matchedMember: submission.matchedMemberId ? (membersById.get(submission.matchedMemberId) ? toMemberSummary(membersById.get(submission.matchedMemberId)!) : null) : null,
    candidateMembers: submission.candidateMemberIds.map((id) => membersById.get(id)).filter((m): m is OrgMember => Boolean(m)).map(toMemberSummary),
    matchConfidence: submission.matchConfidence,
    matchMethod: submission.matchMethod,
    verificationStatus: submission.verificationStatus,
    reviewedByUserId: submission.reviewedByUserId,
    reviewedAt: submission.reviewedAt,
    createdMemberId: submission.createdMemberId,
    appliedAt: submission.appliedAt,
    rejectedAt: submission.rejectedAt,
    rejectionReason: submission.rejectionReason,
    diffByMemberId,
  };
}

const REVIEWABLE_FOR_APPROVE: MemberIntakeSubmissionStatus[] = ["REVIEW_REQUIRED", "VERIFICATION_REQUIRED"];

/** Claims a submission out of the review queue into APPROVED via
 * compare-and-swap, keyed on the status read moments earlier — same CAS
 * idiom as update-engine.ts's own claim, so two admins clicking Approve on
 * the same submission at once can't both proceed (the second gets a fast,
 * clear 409 instead of double-applying). */
async function claimForApproval(
  organizationId: string,
  submissionId: string,
  allowedFrom: MemberIntakeSubmissionStatus[],
  actorUserId: string,
  extra?: Record<string, unknown>
) {
  const submission = await prisma.memberIntakeSubmission.findFirst({ where: { id: submissionId, organizationId } });
  if (!submission) throw new MemberIntakeError("MEMBER_INTAKE_SUBMISSION_NOT_FOUND", "Submission not found.");
  if (!allowedFrom.includes(submission.status)) {
    throw new MemberIntakeError("MEMBER_INTAKE_INVALID_STATUS_TRANSITION", `Submission in status ${submission.status} cannot be reviewed this way.`);
  }
  const claim = await prisma.memberIntakeSubmission.updateMany({
    where: { id: submissionId, status: submission.status },
    data: { status: "APPROVED", reviewedByUserId: actorUserId, reviewedAt: new Date(), ...extra },
  });
  if (claim.count === 0) {
    throw new MemberIntakeError("MEMBER_INTAKE_INVALID_STATUS_TRANSITION", "This submission was already reviewed by someone else. Refresh and try again.");
  }
  return submission;
}

/**
 * Approves a submission as-is (its already-computed matchedMemberId decides
 * create vs. update). Also serves as the §15 "administrator review" fallback
 * verification channel: a VERIFICATION_REQUIRED submission an admin approves
 * here never has to complete OTP — audited with bypassedVerification so
 * that's always visible after the fact, never silent.
 */
export async function approveSubmission(organizationId: string, submissionId: string, actor: MemberMutationActor): Promise<ApplySubmissionResult> {
  if (!actor.userId) throw new MemberIntakeError("MEMBER_INTAKE_INVALID_STATUS_TRANSITION", "A reviewing admin is required.");
  const submission = await claimForApproval(organizationId, submissionId, REVIEWABLE_FOR_APPROVE, actor.userId);
  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "approve",
    entityType: "member_intake_submission",
    entityId: submissionId,
    metadata: { bypassedVerification: submission.status === "VERIFICATION_REQUIRED", matchedMemberId: submission.matchedMemberId },
  });
  return applySubmission(organizationId, submissionId, actor);
}

export async function rejectSubmission(organizationId: string, submissionId: string, actor: MemberMutationActor, reason: string): Promise<void> {
  if (!actor.userId) throw new MemberIntakeError("MEMBER_INTAKE_INVALID_STATUS_TRANSITION", "A reviewing admin is required.");
  const submission = await prisma.memberIntakeSubmission.findFirst({ where: { id: submissionId, organizationId } });
  if (!submission) throw new MemberIntakeError("MEMBER_INTAKE_SUBMISSION_NOT_FOUND", "Submission not found.");
  const allowedFrom: MemberIntakeSubmissionStatus[] = ["SUBMITTED", "VERIFICATION_REQUIRED", "REVIEW_REQUIRED"];
  if (!allowedFrom.includes(submission.status)) {
    throw new MemberIntakeError("MEMBER_INTAKE_INVALID_STATUS_TRANSITION", `Submission in status ${submission.status} cannot be rejected.`);
  }
  const claim = await prisma.memberIntakeSubmission.updateMany({
    where: { id: submissionId, status: submission.status },
    data: { status: "REJECTED", rejectedAt: new Date(), rejectionReason: reason, reviewedByUserId: actor.userId, reviewedAt: new Date() },
  });
  if (claim.count === 0) {
    throw new MemberIntakeError("MEMBER_INTAKE_INVALID_STATUS_TRANSITION", "This submission was already reviewed by someone else. Refresh and try again.");
  }
  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "reject",
    entityType: "member_intake_submission",
    entityId: submissionId,
    metadata: { reason },
  });
}

/** Links an ambiguous (POSSIBLE_MATCH/MULTIPLE_MATCHES) submission to a
 * specific existing member an admin picked, then applies it. Not restricted
 * to the pre-computed candidateMemberIds -- an admin may know the correct
 * match even when the matching engine didn't surface it -- but the member
 * MUST belong to this organization (never trusted from elsewhere). */
export async function linkSubmissionToMember(organizationId: string, submissionId: string, memberId: string, actor: MemberMutationActor): Promise<ApplySubmissionResult> {
  if (!actor.userId) throw new MemberIntakeError("MEMBER_INTAKE_INVALID_STATUS_TRANSITION", "A reviewing admin is required.");
  const member = await prisma.orgMember.findFirst({ where: { id: memberId, organizationId } });
  if (!member) throw new MemberIntakeError("MEMBER_INTAKE_SUBMISSION_NOT_FOUND", "That member was not found in this organization.");

  await claimForApproval(organizationId, submissionId, ["REVIEW_REQUIRED"], actor.userId, { matchedMemberId: memberId });
  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "link",
    entityType: "member_intake_submission",
    entityId: submissionId,
    metadata: { linkedMemberId: memberId },
  });
  return applySubmission(organizationId, submissionId, actor);
}

/** The "create new anyway" review action -- an admin decided a REVIEW_REQUIRED
 * submission is genuinely a new person despite candidate matches, and
 * explicitly overrides that. Clears matchedMemberId so applySubmission takes
 * the create path regardless of the form's autoCreateNewMember setting
 * (APPROVED status alone authorizes it, per update-engine.ts). */
export async function createNewMemberFromSubmission(organizationId: string, submissionId: string, actor: MemberMutationActor): Promise<ApplySubmissionResult> {
  if (!actor.userId) throw new MemberIntakeError("MEMBER_INTAKE_INVALID_STATUS_TRANSITION", "A reviewing admin is required.");
  await claimForApproval(organizationId, submissionId, ["REVIEW_REQUIRED"], actor.userId, { matchedMemberId: null });
  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "create_new",
    entityType: "member_intake_submission",
    entityId: submissionId,
    metadata: {},
  });
  return applySubmission(organizationId, submissionId, actor);
}
