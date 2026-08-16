import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getServerEnv } from "@/lib/env";
import { normalizeToE164 } from "@/lib/phone";
import { MemberIntakeError } from "./errors";
import { resolvePublicIntakeSourceId } from "./forms";
import { matchIntakeSubmission, type SubmittedIdentity } from "./matching";
import type { MemberIntakeFormField, MemberIntakeSubmissionStatus } from "@prisma/client";

/**
 * Member Intake & Profile Update (MEMBER-QR-A) — turns raw, untrusted public
 * submission input into a stored MemberIntakeSubmission row: validated
 * against the form's own field definitions (never the client's idea of what
 * was required), matched against existing members, and routed to the
 * correct initial status. Never mutates an OrgMember directly -- that only
 * ever happens in update-engine.ts's applySubmission(), and only after this
 * function's routing decision (and, where required, verification) allows it.
 */

/** Privacy-safe abuse-signal hash -- HMAC (not bare SHA-256) so the ~4
 * billion-address IPv4 space can't be rainbow-tabled back to a raw IP by
 * anyone with read access to the column. Reuses NEXTAUTH_SECRET as the key,
 * the same always-present server secret already trusted app-wide; this
 * value is never displayed to staff and never used for anything beyond
 * abuse-signal correlation (see submittedIpHash's schema doc comment). */
export function hashSubmitterIp(ipAddress: string): string {
  const { NEXTAUTH_SECRET } = getServerEnv();
  return crypto.createHmac("sha256", NEXTAUTH_SECRET).update(ipAddress).digest("hex");
}

const MAX_TEXT_LENGTH = 2000;
const MAX_TEXTAREA_LENGTH = 8000;

export type ValidatedFieldValue = string | string[] | boolean | number;

function isBlankInput(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/** Validates one submitted value against its field definition. Throws
 * MEMBER_INTAKE_VALIDATION_ERROR (never silently coerces or drops) on
 * anything that doesn't fit -- an untrusted client gets a clear 400, not a
 * best-effort guess at what it meant. */
function validateFieldValue(field: MemberIntakeFormField, raw: unknown): ValidatedFieldValue | null {
  if (isBlankInput(raw)) {
    if (field.required) {
      throw new MemberIntakeError("MEMBER_INTAKE_VALIDATION_ERROR", `"${field.label}" is required.`);
    }
    return null;
  }

  switch (field.fieldType) {
    case "TEXT":
    case "ADDRESS": {
      const value = String(raw).trim();
      if (value.length > MAX_TEXT_LENGTH) {
        throw new MemberIntakeError("MEMBER_INTAKE_VALIDATION_ERROR", `"${field.label}" is too long.`);
      }
      return value;
    }
    case "TEXTAREA": {
      const value = String(raw).trim();
      if (value.length > MAX_TEXTAREA_LENGTH) {
        throw new MemberIntakeError("MEMBER_INTAKE_VALIDATION_ERROR", `"${field.label}" is too long.`);
      }
      return value;
    }
    case "EMAIL": {
      const value = String(raw).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > MAX_TEXT_LENGTH) {
        throw new MemberIntakeError("MEMBER_INTAKE_VALIDATION_ERROR", `"${field.label}" must be a valid email address.`);
      }
      return value;
    }
    case "PHONE": {
      const normalized = normalizeToE164(String(raw));
      if (!normalized) {
        throw new MemberIntakeError("MEMBER_INTAKE_VALIDATION_ERROR", `"${field.label}" must be a valid phone number.`);
      }
      return normalized;
    }
    case "DATE": {
      const parsed = new Date(String(raw));
      if (Number.isNaN(parsed.getTime())) {
        throw new MemberIntakeError("MEMBER_INTAKE_VALIDATION_ERROR", `"${field.label}" must be a valid date.`);
      }
      return parsed.toISOString();
    }
    case "NUMBER": {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new MemberIntakeError("MEMBER_INTAKE_VALIDATION_ERROR", `"${field.label}" must be a number.`);
      }
      return value;
    }
    case "BOOLEAN":
    case "CHECKBOX":
      return Boolean(raw);
    case "SELECT":
    case "RADIO": {
      const value = String(raw);
      if (!field.options.includes(value)) {
        throw new MemberIntakeError("MEMBER_INTAKE_VALIDATION_ERROR", `"${field.label}" has an invalid selection.`);
      }
      return value;
    }
    case "MULTISELECT": {
      if (!Array.isArray(raw)) {
        throw new MemberIntakeError("MEMBER_INTAKE_VALIDATION_ERROR", `"${field.label}" must be a list of selections.`);
      }
      const values = raw.map(String);
      if (values.some((v) => !field.options.includes(v))) {
        throw new MemberIntakeError("MEMBER_INTAKE_VALIDATION_ERROR", `"${field.label}" has an invalid selection.`);
      }
      return values;
    }
    default:
      return String(raw).trim();
  }
}

/** Only fields actually mapped onto identity-relevant OrgMember columns feed
 * the matching engine -- a CUSTOM field (e.g. "T-shirt size") can never
 * influence who this submission is matched against. */
function buildSubmittedIdentity(fields: MemberIntakeFormField[], values: Record<string, ValidatedFieldValue | null>): SubmittedIdentity {
  const byTarget = new Map<string, ValidatedFieldValue | null>();
  for (const field of fields) {
    if (field.targetEntity === "MEMBER" && field.targetField) {
      byTarget.set(field.targetField, values[field.fieldKey] ?? null);
    }
  }
  const dobRaw = byTarget.get("dateOfBirth");
  return {
    firstName: typeof byTarget.get("firstName") === "string" ? (byTarget.get("firstName") as string) : null,
    lastName: typeof byTarget.get("lastName") === "string" ? (byTarget.get("lastName") as string) : null,
    email: typeof byTarget.get("email") === "string" ? (byTarget.get("email") as string) : null,
    phone: typeof byTarget.get("phone") === "string" ? (byTarget.get("phone") as string) : null,
    dateOfBirth: typeof dobRaw === "string" ? new Date(dobRaw) : null,
    addressLine1: typeof byTarget.get("addressLine1") === "string" ? (byTarget.get("addressLine1") as string) : null,
    zipCode: typeof byTarget.get("zipCode") === "string" ? (byTarget.get("zipCode") as string) : null,
  };
}

export interface RecordSubmissionInput {
  formId: string;
  sourceToken?: string | null;
  /** Raw, untrusted client input keyed by fieldKey. */
  fieldValues: Record<string, unknown>;
  ipAddress: string;
  userAgent?: string | null;
}

export interface RecordedSubmission {
  submissionId: string;
  status: MemberIntakeSubmissionStatus;
}

/**
 * Records a public submission. Re-validates the form is still live
 * (status/expiry can change between page-load and submit -- this is the
 * actual mutation point, so it re-checks rather than trusting an earlier
 * resolvePublicIntakeForm() call), validates every value against the form's
 * own field definitions, runs identity matching, and decides the
 * submission's initial status. Never calls createMember/updateMember itself
 * -- that's update-engine.ts's job, invoked separately (see
 * processAutoEligibleSubmission there) once this function returns.
 */
export async function recordSubmission(input: RecordSubmissionInput): Promise<RecordedSubmission> {
  const form = await prisma.memberIntakeForm.findUnique({
    where: { id: input.formId },
    include: { fields: true },
  });
  if (!form) throw new MemberIntakeError("MEMBER_INTAKE_FORM_NOT_FOUND", "Form not found.");
  if (form.status !== "ACTIVE") throw new MemberIntakeError("MEMBER_INTAKE_FORM_NOT_ACTIVE", "This form is no longer accepting submissions.");
  if (form.expiresAt && form.expiresAt < new Date()) {
    throw new MemberIntakeError("MEMBER_INTAKE_FORM_EXPIRED", "This form is no longer accepting submissions.");
  }

  const validatedValues: Record<string, ValidatedFieldValue | null> = {};
  for (const field of form.fields) {
    validatedValues[field.fieldKey] = validateFieldValue(field, input.fieldValues[field.fieldKey]);
  }

  const identity = buildSubmittedIdentity(form.fields, validatedValues);
  const matchResult = await matchIntakeSubmission(form.organizationId, identity);
  const sourceId = await resolvePublicIntakeSourceId(form.id, input.sourceToken);

  let status: MemberIntakeSubmissionStatus;
  let matchedMemberId: string | null = null;
  let verificationStatus: "NOT_REQUIRED" | "PENDING" = "NOT_REQUIRED";

  switch (matchResult.status) {
    case "NO_MATCH":
      status = form.autoCreateNewMember ? "SUBMITTED" : "REVIEW_REQUIRED";
      break;
    case "CONFIDENT_MATCH":
      matchedMemberId = matchResult.memberId;
      if (form.requireVerificationForExisting) {
        status = "VERIFICATION_REQUIRED";
        verificationStatus = "PENDING";
      } else if (form.duplicateHandlingMode === "AUTO_LINK_CONFIDENT") {
        status = "SUBMITTED";
      } else {
        status = "REVIEW_REQUIRED";
      }
      break;
    case "POSSIBLE_MATCH":
    case "MULTIPLE_MATCHES":
      // Never auto-anything on an ambiguous match, regardless of org policy.
      status = "REVIEW_REQUIRED";
      break;
    default:
      status = "REVIEW_REQUIRED";
  }

  const submission = await prisma.memberIntakeSubmission.create({
    data: {
      organizationId: form.organizationId,
      formId: form.id,
      sourceId,
      status,
      submittedIpHash: hashSubmitterIp(input.ipAddress),
      userAgent: input.userAgent ?? null,
      fieldValues: validatedValues,
      matchedMemberId,
      candidateMemberIds: matchResult.status === "POSSIBLE_MATCH" || matchResult.status === "MULTIPLE_MATCHES" ? matchResult.candidateMemberIds : [],
      matchConfidence: matchResult.confidence,
      matchMethod: matchResult.method,
      verificationStatus,
    },
  });

  return { submissionId: submission.id, status: submission.status };
}
