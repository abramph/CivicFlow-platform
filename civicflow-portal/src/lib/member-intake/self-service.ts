import type { MemberIntakeFieldType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applySubmission, type ApplySubmissionResult } from "./update-engine";
import { validateFieldValue, type ValidatedFieldValue } from "./submissions";
import { ALLOWED_MEMBER_TARGET_FIELDS, effectiveFieldSensitivity, type AllowedMemberTargetField } from "./sensitivity";
import { generateIntakeToken } from "./token";
import { RESERVED_SELF_SERVICE_FORM_NAME } from "./forms";
import type { MemberMutationActor } from "@/lib/member-mutations";

/**
 * Member Intake & Profile Update (MEMBER-QR-J) — authenticated member
 * self-service ("Profile → Update My Information"), reusing the SAME
 * submission/apply backend as the anonymous QR/public form (§23/§32's
 * explicit requirement), not a parallel update path.
 *
 * The key difference from the public flow: there is no matching step and no
 * OTP verification here. The caller is already an authenticated member --
 * their session IS the strong identity signal §23 describes ("do not
 * require OTP unnecessarily for already strongly authenticated members").
 * matchedMemberId is set directly from the verified mobile session
 * (requireMobileMembership's memberId), never resolved via matching.ts.
 * verificationStatus is stamped NOT_REQUIRED for the same reason.
 *
 * Every submitted field still passes through validateFieldValue() and then
 * applySubmission()'s own sensitivity gating (sensitivity.ts) exactly as a
 * public submission would -- so a HIGH-sensitivity change (legal name,
 * email, date of birth) still can never auto-apply from a mobile session
 * alone; it lands in REVIEW_REQUIRED and shows up in the SAME admin review
 * queue (MEMBER-QR-G) with the SAME field-level diff, just sourced from this
 * system form instead of a published one.
 */

/** Every allow-listed member field the self-service form can touch. Excludes
 * the comms* toggles -- those already have a working, tested, more nuanced
 * dedicated path (PATCH /api/mobile/profile, with its own smsOptedOutAt
 * carrier-STOP-only rule) that this milestone deliberately leaves untouched
 * rather than folding into a not-obviously-better generic path. */
const SELF_SERVICE_FIELDS: { targetField: Exclude<AllowedMemberTargetField, "commsPushEnabled" | "commsEmailEnabled" | "commsSmsEnabled">; label: string; fieldType: MemberIntakeFieldType }[] = [
  { targetField: "firstName", label: "First name", fieldType: "TEXT" },
  { targetField: "lastName", label: "Last name", fieldType: "TEXT" },
  { targetField: "preferredName", label: "Preferred name", fieldType: "TEXT" },
  { targetField: "email", label: "Email", fieldType: "EMAIL" },
  { targetField: "phone", label: "Phone", fieldType: "PHONE" },
  { targetField: "dateOfBirth", label: "Date of birth", fieldType: "DATE" },
  { targetField: "gender", label: "Gender", fieldType: "TEXT" },
  { targetField: "addressLine1", label: "Address line 1", fieldType: "ADDRESS" },
  { targetField: "addressLine2", label: "Address line 2", fieldType: "ADDRESS" },
  { targetField: "city", label: "City", fieldType: "TEXT" },
  { targetField: "state", label: "State", fieldType: "TEXT" },
  { targetField: "zipCode", label: "ZIP code", fieldType: "TEXT" },
  { targetField: "country", label: "Country", fieldType: "TEXT" },
  { targetField: "householdName", label: "Household name", fieldType: "TEXT" },
  { targetField: "emergencyContactName", label: "Emergency contact name", fieldType: "TEXT" },
  { targetField: "emergencyContactPhone", label: "Emergency contact phone", fieldType: "PHONE" },
];

/**
 * Lazily gets (or, on first use for this org, creates) the hidden system
 * form that anchors self-service submissions. Never surfaced in the Forms
 * list UI, never published/QR'd, DRAFT status -- it exists purely as the
 * MemberIntakeForm/Field row every MemberIntakeSubmission requires, so
 * self-service reuses the real field-sensitivity/diff/apply machinery
 * instead of a shortcut that bypasses it. A benign race where two concurrent
 * first-time callers each create one is tolerated (ORDER BY createdAt asc
 * always picks the same one afterward) rather than adding locking for a
 * one-time-per-organization initialization.
 */
async function getOrCreateSelfServiceForm(organizationId: string) {
  const existing = await prisma.memberIntakeForm.findFirst({
    where: { organizationId, name: RESERVED_SELF_SERVICE_FORM_NAME, purpose: "PROFILE_UPDATE" },
    include: { fields: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  const form = await prisma.memberIntakeForm.create({
    data: {
      organizationId,
      name: RESERVED_SELF_SERVICE_FORM_NAME,
      publicToken: generateIntakeToken(),
      purpose: "PROFILE_UPDATE",
      status: "DRAFT",
      title: "Update My Information",
      description: "Update your own contact information.",
      requireVerificationForExisting: false,
      autoCreateNewMember: false,
      autoApplySafeUpdates: true,
      requireReviewForSensitiveUpdates: false,
      duplicateHandlingMode: "REVIEW",
    },
  });

  await prisma.memberIntakeFormField.createMany({
    data: SELF_SERVICE_FIELDS.map((field, index) => ({
      formId: form.id,
      fieldKey: field.targetField,
      label: field.label,
      fieldType: field.fieldType,
      required: false,
      order: index,
      options: [],
      targetEntity: "MEMBER" as const,
      targetField: field.targetField,
      sensitivity: effectiveFieldSensitivity(field.targetField, "LOW"),
      isCustomField: false,
    })),
  });

  return prisma.memberIntakeForm.findFirstOrThrow({ where: { id: form.id }, include: { fields: true } });
}

export interface SelfServiceUpdateResult {
  status: ApplySubmissionResult["status"];
  appliedFieldCount: number;
}

/**
 * Submits and immediately applies (subject to sensitivity gating) an
 * authenticated member's own profile update. `fieldValues` keys must be
 * `AllowedMemberTargetField` names -- the mobile client sends target field
 * names directly (there's no admin-authored field config to key off here,
 * unlike the public form), validated the same as any other submission
 * before being trusted.
 */
export async function submitMemberSelfServiceUpdate(
  organizationId: string,
  memberId: string,
  actor: MemberMutationActor,
  fieldValues: Partial<Record<AllowedMemberTargetField, unknown>>
): Promise<SelfServiceUpdateResult> {
  const form = await getOrCreateSelfServiceForm(organizationId);

  const providedKeys = Object.keys(fieldValues).filter((key) => ALLOWED_MEMBER_TARGET_FIELDS.includes(key as AllowedMemberTargetField));
  const validatedValues: Record<string, ValidatedFieldValue | null> = {};
  for (const key of providedKeys) {
    const field = form.fields.find((f) => f.fieldKey === key);
    if (!field) continue; // not part of the self-service field set (e.g. a comms* key) -- ignored, not an error
    validatedValues[key] = validateFieldValue(field, fieldValues[key as AllowedMemberTargetField]);
  }

  const submission = await prisma.memberIntakeSubmission.create({
    data: {
      organizationId,
      formId: form.id,
      status: "SUBMITTED",
      matchedMemberId: memberId,
      candidateMemberIds: [],
      matchConfidence: 100,
      matchMethod: "authenticated_session",
      verificationStatus: "NOT_REQUIRED",
      fieldValues: validatedValues,
    },
  });

  const result = await applySubmission(organizationId, submission.id, actor);
  return { status: result.status, appliedFieldCount: result.appliedFieldCount };
}
