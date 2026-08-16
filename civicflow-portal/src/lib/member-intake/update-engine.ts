import { prisma } from "@/lib/prisma";
import { createMember, updateMember, type MemberMutationActor, type CreateMemberInput, type UpdateMemberInput } from "@/lib/member-mutations";
import { ALLOWED_MEMBER_TARGET_FIELDS, type AllowedMemberTargetField } from "./sensitivity";
import { MemberIntakeError } from "./errors";
import type { MemberIntakeFormField, MemberIntakeSubmissionStatus } from "@prisma/client";

/**
 * Member Intake & Profile Update (MEMBER-QR-A, race-hardened in
 * MEMBER-QR-E) -- the diff-based update/create engine. The ONE place a
 * submission's validated fieldValues are ever turned into an actual
 * OrgMember write, and it always goes through the existing createMember/
 * updateMember business logic (plan gating, validation, audit, timeline) --
 * never a raw prisma.orgMember.update.
 *
 * Sensitivity gating happens HERE, at apply time, not at submission-routing
 * time (see submissions.ts) -- a submission can be identity-verified
 * (VERIFICATION_REQUIRED -> VERIFIED) and still land in REVIEW_REQUIRED here
 * if the actual field-level diff touches anything outside the org's
 * configured auto-apply policy. This is deliberately all-or-nothing per
 * submission: if every changed field clears the policy, every change is
 * applied in one call; if even one field doesn't, NOTHING is applied and the
 * whole submission (with its already-computed diff) goes to admin review --
 * simpler and safer than partial-apply for a first milestone, and still
 * satisfies "field-level diff" since the diff itself is what the review
 * queue will show (milestone G).
 *
 * HIGH-sensitivity fields are never auto-applied, full stop, regardless of
 * any org policy flag -- enforced below independent of autoApplySafeUpdates/
 * requireReviewForSensitiveUpdates.
 *
 * MEMBER-QR-E hardening: applySubmission() now atomically CLAIMS a
 * submission (a compare-and-swap status transition keyed on the status it
 * just read, same CAS idiom updateMember() already uses for
 * membershipStatus) before doing any actual work. Without this, two
 * concurrent calls -- a network-retried "verify" request being the
 * realistic trigger, since the public route calls applySubmission()
 * immediately after a successful code check -- could both pass the
 * eligibility check before either had written anything, and both proceed
 * to call createMember(), creating two duplicate member records from one
 * submission. The claim makes the second caller's own compare-and-swap
 * affect zero rows, so it fails fast instead of doing the work twice --
 * §27's "retry must not create a second member," enforced structurally.
 */

function canAutoApplyField(sensitivity: "LOW" | "MODERATE" | "HIGH", autoApplySafeUpdates: boolean, requireReviewForSensitiveUpdates: boolean): boolean {
  if (sensitivity === "HIGH") return false;
  if (!autoApplySafeUpdates) return false;
  if (sensitivity === "MODERATE" && requireReviewForSensitiveUpdates) return false;
  return true;
}

const ELIGIBLE_STATUSES: MemberIntakeSubmissionStatus[] = ["SUBMITTED", "VERIFICATION_REQUIRED", "APPROVED"];

export interface ApplySubmissionResult {
  status: MemberIntakeSubmissionStatus;
  memberId: string | null;
  appliedFieldCount: number;
}

/**
 * Attempts to apply a submission's changes. `actor.userId === null` means an
 * automated, policy-gated apply with no human present (see
 * MemberMutationActor's doc comment) -- used for the auto-eligible paths.
 * When invoked from the future admin review queue (milestone G) after an
 * explicit approval, pass the approving admin as actor instead.
 */
export async function applySubmission(organizationId: string, submissionId: string, actor: MemberMutationActor): Promise<ApplySubmissionResult> {
  const submission = await prisma.memberIntakeSubmission.findFirst({
    where: { id: submissionId, organizationId },
    include: { form: { include: { fields: true } } },
  });
  if (!submission) throw new MemberIntakeError("MEMBER_INTAKE_SUBMISSION_NOT_FOUND", "Submission not found.");

  if (!ELIGIBLE_STATUSES.includes(submission.status)) {
    throw new MemberIntakeError("MEMBER_INTAKE_INVALID_STATUS_TRANSITION", `Submission in status ${submission.status} cannot be applied.`);
  }
  // A verified-identity path (CONFIDENT_MATCH + requireVerificationForExisting)
  // must actually have completed verification before anything is written --
  // being in VERIFICATION_REQUIRED status alone is not sufficient.
  if (submission.status === "VERIFICATION_REQUIRED" && submission.verificationStatus !== "VERIFIED") {
    throw new MemberIntakeError("MEMBER_INTAKE_INVALID_STATUS_TRANSITION", "This submission has not completed identity verification yet.");
  }
  if (!submission.matchedMemberId && !submission.form.autoCreateNewMember && submission.status !== "APPROVED") {
    throw new MemberIntakeError("MEMBER_INTAKE_INVALID_STATUS_TRANSITION", "This form does not allow creating new members without admin approval.");
  }

  // Atomic claim -- see the file-level doc comment. A concurrent duplicate
  // call (e.g. a retried request) reads a status that's no longer eligible
  // by the time its own claim attempt runs, so `count` is 0 and it fails
  // fast here instead of doing the create/update work twice.
  const claim = await prisma.memberIntakeSubmission.updateMany({
    where: { id: submission.id, status: submission.status },
    data: { status: "APPLIED" },
  });
  if (claim.count === 0) {
    throw new MemberIntakeError("MEMBER_INTAKE_INVALID_STATUS_TRANSITION", "This submission is already being processed or was already applied.");
  }

  const fieldValues = submission.fieldValues as Record<string, unknown>;
  const memberFields = submission.form.fields.filter(
    (f): f is MemberIntakeFormField & { targetField: string } =>
      f.targetEntity === "MEMBER" && f.targetField !== null && ALLOWED_MEMBER_TARGET_FIELDS.includes(f.targetField as AllowedMemberTargetField)
  );

  if (submission.matchedMemberId) {
    return applyUpdate(organizationId, submission.matchedMemberId, submission, memberFields, fieldValues, actor);
  }
  return applyCreate(organizationId, submission, memberFields, fieldValues, actor);
}

async function applyUpdate(
  organizationId: string,
  memberId: string,
  submission: { id: string; form: { autoApplySafeUpdates: boolean; requireReviewForSensitiveUpdates: boolean } },
  memberFields: (MemberIntakeFormField & { targetField: string })[],
  fieldValues: Record<string, unknown>,
  actor: MemberMutationActor
): Promise<ApplySubmissionResult> {
  const existing = await prisma.orgMember.findFirst({ where: { id: memberId, organizationId } });
  if (!existing) throw new MemberIntakeError("MEMBER_INTAKE_SUBMISSION_NOT_FOUND", "The matched member no longer exists.");

  const updateInput: UpdateMemberInput = {};
  let changedCount = 0;
  let blockedBySensitivity = false;

  for (const field of memberFields) {
    const key = field.targetField as keyof UpdateMemberInput;
    const submittedValue = fieldValues[field.fieldKey];
    if (submittedValue === null || submittedValue === undefined) continue; // blank never erases -- §17's explicit rule

    const currentValue = (existing as unknown as Record<string, unknown>)[field.targetField];
    const currentComparable = currentValue instanceof Date ? currentValue.toISOString() : (currentValue ?? null);
    const submittedComparable = submittedValue;
    if (JSON.stringify(currentComparable) === JSON.stringify(submittedComparable)) continue; // no real change

    if (!canAutoApplyField(field.sensitivity, submission.form.autoApplySafeUpdates, submission.form.requireReviewForSensitiveUpdates)) {
      blockedBySensitivity = true;
      continue;
    }

    (updateInput as Record<string, unknown>)[key] = submittedValue;
    changedCount += 1;
  }

  if (blockedBySensitivity) {
    // Already claimed as APPLIED by the caller's CAS -- correct that here,
    // this submission needs a human, not an auto-apply.
    await prisma.memberIntakeSubmission.update({ where: { id: submission.id }, data: { status: "REVIEW_REQUIRED" } });
    return { status: "REVIEW_REQUIRED", memberId, appliedFieldCount: 0 };
  }

  if (changedCount > 0) {
    const result = await updateMember(organizationId, actor, memberId, updateInput);
    if (!result.ok) {
      throw new MemberIntakeError("MEMBER_INTAKE_VALIDATION_ERROR", result.error);
    }
  }

  const applied = await prisma.memberIntakeSubmission.update({
    where: { id: submission.id },
    data: { appliedAt: new Date(), matchedMemberId: memberId },
  });
  return { status: applied.status, memberId, appliedFieldCount: changedCount };
}

async function applyCreate(
  organizationId: string,
  submission: { id: string },
  memberFields: (MemberIntakeFormField & { targetField: string })[],
  fieldValues: Record<string, unknown>,
  actor: MemberMutationActor
): Promise<ApplySubmissionResult> {
  const createInput: Partial<CreateMemberInput> = {};
  for (const field of memberFields) {
    const value = fieldValues[field.fieldKey];
    if (value === null || value === undefined) continue;
    (createInput as Record<string, unknown>)[field.targetField] = value;
  }

  if (!createInput.firstName || !createInput.lastName) {
    // Already claimed as APPLIED by the caller's CAS -- roll that back since
    // nothing was actually created; the org's form configuration needs
    // fixing, not a retry.
    await prisma.memberIntakeSubmission.update({ where: { id: submission.id }, data: { status: "REVIEW_REQUIRED" } });
    throw new MemberIntakeError(
      "MEMBER_INTAKE_VALIDATION_ERROR",
      "This form must collect first and last name before a new member can be created."
    );
  }

  const result = await createMember(organizationId, actor, createInput as CreateMemberInput);
  if (!result.ok) {
    await prisma.memberIntakeSubmission.update({ where: { id: submission.id }, data: { status: "REVIEW_REQUIRED" } });
    throw new MemberIntakeError("MEMBER_INTAKE_VALIDATION_ERROR", result.error);
  }

  const applied = await prisma.memberIntakeSubmission.update({
    where: { id: submission.id },
    data: { appliedAt: new Date(), createdMemberId: result.data.id },
  });
  return { status: applied.status, memberId: result.data.id, appliedFieldCount: memberFields.length };
}
