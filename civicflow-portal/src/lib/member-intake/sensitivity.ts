import type { MemberIntakeFieldSensitivity } from "@prisma/client";

/**
 * Member Intake & Profile Update (MEMBER-QR-A) — the ONE authoritative list
 * of which OrgMember columns a form field is ever allowed to target, and
 * how sensitive each one is. This is the enforcement point for §16/§25/§40's
 * rule: a public form can only ever write to a column on this list, and a
 * tampered `targetField` value that isn't on it is rejected at field-
 * creation time (see createFormField in forms.ts) — never resolved
 * dynamically from client input at submission time.
 *
 * Deliberately excluded, regardless of what a client sends: membershipStatus,
 * isDelinquent/delinquentSince (RBAC-adjacent/financial state), membershipCategoryId
 * (permissions-adjacent), householdId/userId/organizationId/id/memberNumber
 * (identity/relationship plumbing), every SMS/WhatsApp opt-in consent
 * field (has its own dedicated recordSmsOptIn()-style service and audit
 * trail -- never touched by generic field mapping), notes (internal staff
 * annotation), statusChangedAt/By/Reason, lastDuesEvaluationAt, createdAt/
 * updatedAt.
 */
export const ALLOWED_MEMBER_TARGET_FIELDS = [
  "firstName",
  "lastName",
  "preferredName",
  "email",
  "phone",
  "dateOfBirth",
  "gender",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "zipCode",
  "country",
  "householdName",
  "emergencyContactName",
  "emergencyContactPhone",
  "commsPushEnabled",
  "commsEmailEnabled",
  "commsSmsEnabled",
] as const;

export type AllowedMemberTargetField = (typeof ALLOWED_MEMBER_TARGET_FIELDS)[number];

export function isAllowedMemberTargetField(value: string): value is AllowedMemberTargetField {
  return (ALLOWED_MEMBER_TARGET_FIELDS as readonly string[]).includes(value);
}

/**
 * The authoritative sensitivity for every allow-listed field. A field
 * definition's own `sensitivity` column (admin-configurable, LOW by
 * default) can only ever be set to this value or something MORE
 * restrictive -- never less -- enforced in createFormField/updateFormField.
 * HIGH fields are never auto-applied by any org policy, regardless of
 * autoApplySafeUpdates (see canAutoApply in update-engine.ts).
 */
export const MEMBER_TARGET_FIELD_SENSITIVITY: Record<AllowedMemberTargetField, MemberIntakeFieldSensitivity> = {
  firstName: "HIGH",
  lastName: "HIGH",
  preferredName: "LOW",
  email: "HIGH",
  phone: "MODERATE",
  dateOfBirth: "HIGH",
  gender: "MODERATE",
  addressLine1: "MODERATE",
  addressLine2: "MODERATE",
  city: "MODERATE",
  state: "MODERATE",
  zipCode: "MODERATE",
  country: "MODERATE",
  householdName: "MODERATE",
  emergencyContactName: "LOW",
  emergencyContactPhone: "LOW",
  commsPushEnabled: "LOW",
  commsEmailEnabled: "LOW",
  commsSmsEnabled: "LOW",
};

const SENSITIVITY_RANK: Record<MemberIntakeFieldSensitivity, number> = { LOW: 0, MODERATE: 1, HIGH: 2 };

/** The effective sensitivity for a field is never less restrictive than the
 * target column's own floor, even if an admin mis-configured it lower. */
export function effectiveFieldSensitivity(
  targetField: AllowedMemberTargetField | null,
  configured: MemberIntakeFieldSensitivity
): MemberIntakeFieldSensitivity {
  if (!targetField) return configured;
  const floor = MEMBER_TARGET_FIELD_SENSITIVITY[targetField];
  return SENSITIVITY_RANK[floor] > SENSITIVITY_RANK[configured] ? floor : configured;
}
