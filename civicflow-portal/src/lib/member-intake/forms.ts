import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-guards";
import { requireOrganizationLabFeature } from "@/lib/labs/access";
import { createAuditEvent } from "@/lib/audit";
import { PERMISSIONS, type Permission } from "@/lib/rbac";
import type {
  MemberIntakeFormPurpose,
  MemberIntakeFormStatus,
  MemberIntakeFieldType,
  MemberIntakeTargetEntity,
  MemberIntakeFieldSensitivity,
  MemberIntakeDuplicateMode,
} from "@prisma/client";
import { MemberIntakeError } from "./errors";
import { generateIntakeToken } from "./token";
import { isAllowedMemberTargetField, effectiveFieldSensitivity } from "./sensitivity";

/**
 * MEMBER-QR-J's self-service.ts lazily provisions ONE hidden system form per
 * organization (name+purpose below) to anchor authenticated-member
 * submissions in the same MemberIntakeForm/Submission machinery a published
 * form uses. It must never be reachable through the normal admin UI: not
 * listed (see listIntakeForms below), and never publishable (see
 * transitionFormStatus below) -- an admin accidentally publishing it would
 * expose every allow-listed member field as an anonymous-facing public form
 * under a real, previously-unseen URL. Defined here (not in self-service.ts)
 * so this file's own list/publish guards don't need a circular import back
 * to it.
 */
export const RESERVED_SELF_SERVICE_FORM_NAME = "Member Self-Service Profile Update";
const RESERVED_SELF_SERVICE_FORM_PURPOSE: MemberIntakeFormPurpose = "PROFILE_UPDATE";

/**
 * Member Intake & Profile Update (MEMBER-QR-A) — form lifecycle, field
 * configuration, source/campaign management, and the public-resolution gate
 * function. Mirrors the shape of src/lib/union/cases-guard.ts (staff-path
 * capability guard) and src/lib/giving/public-giving.ts (public-path
 * single-gate, no-enumeration discipline) — never mixed.
 */

async function requireMemberIntakeAccess(permission: Permission) {
  const { organizationId, session, role } = await requirePermission(permission, "throw");
  // The Labs gate controls whether the ADMIN UI exists at all for this
  // organization; it is never the security boundary by itself (§38's
  // explicit "do not use a feature flag as a security boundary") -- the
  // permission check above already ran first and is what actually
  // authorizes this specific caller.
  await requireOrganizationLabFeature(organizationId, "memberIntake");
  return { organizationId, session, role };
}

export const requireMemberIntakeView = () => requireMemberIntakeAccess(PERMISSIONS.MEMBER_INTAKE_VIEW);
export const requireMemberIntakeManage = () => requireMemberIntakeAccess(PERMISSIONS.MEMBER_INTAKE_MANAGE);
export const requireMemberIntakePublish = () => requireMemberIntakeAccess(PERMISSIONS.MEMBER_INTAKE_PUBLISH);
export const requireMemberIntakeReview = () => requireMemberIntakeAccess(PERMISSIONS.MEMBER_INTAKE_REVIEW);
export const requireMemberIntakeExport = () => requireMemberIntakeAccess(PERMISSIONS.MEMBER_INTAKE_EXPORT);

// ── Form CRUD ────────────────────────────────────────────────────────────

export interface IntakeFormInput {
  name: string;
  purpose: MemberIntakeFormPurpose;
  title: string;
  description?: string | null;
  successMessage?: string | null;
  requireVerificationForExisting?: boolean;
  autoCreateNewMember?: boolean;
  autoApplySafeUpdates?: boolean;
  requireReviewForSensitiveUpdates?: boolean;
  duplicateHandlingMode?: MemberIntakeDuplicateMode;
  expiresAt?: Date | null;
}

export async function createIntakeForm(organizationId: string, actorUserId: string, input: IntakeFormInput) {
  const form = await prisma.memberIntakeForm.create({
    data: {
      organizationId,
      name: input.name,
      publicToken: generateIntakeToken(),
      purpose: input.purpose,
      title: input.title,
      description: input.description ?? null,
      successMessage: input.successMessage ?? null,
      requireVerificationForExisting: input.requireVerificationForExisting ?? true,
      autoCreateNewMember: input.autoCreateNewMember ?? false,
      autoApplySafeUpdates: input.autoApplySafeUpdates ?? false,
      requireReviewForSensitiveUpdates: input.requireReviewForSensitiveUpdates ?? true,
      duplicateHandlingMode: input.duplicateHandlingMode ?? "REVIEW",
      expiresAt: input.expiresAt ?? null,
      createdByUserId: actorUserId,
      status: "DRAFT",
    },
  });
  await createAuditEvent({
    organizationId,
    actorUserId,
    action: "create",
    entityType: "member_intake_form",
    entityId: form.id,
    metadata: { name: form.name, purpose: form.purpose },
  });
  return form;
}

export async function updateIntakeForm(
  organizationId: string,
  formId: string,
  actorUserId: string,
  input: Partial<IntakeFormInput>
) {
  const existing = await prisma.memberIntakeForm.findFirst({ where: { id: formId, organizationId } });
  if (!existing) throw new MemberIntakeError("MEMBER_INTAKE_FORM_NOT_FOUND", "Form not found.");

  const updated = await prisma.memberIntakeForm.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.successMessage !== undefined ? { successMessage: input.successMessage } : {}),
      ...(input.requireVerificationForExisting !== undefined ? { requireVerificationForExisting: input.requireVerificationForExisting } : {}),
      ...(input.autoCreateNewMember !== undefined ? { autoCreateNewMember: input.autoCreateNewMember } : {}),
      ...(input.autoApplySafeUpdates !== undefined ? { autoApplySafeUpdates: input.autoApplySafeUpdates } : {}),
      ...(input.requireReviewForSensitiveUpdates !== undefined ? { requireReviewForSensitiveUpdates: input.requireReviewForSensitiveUpdates } : {}),
      ...(input.duplicateHandlingMode !== undefined ? { duplicateHandlingMode: input.duplicateHandlingMode } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    },
  });
  await createAuditEvent({
    organizationId,
    actorUserId,
    action: "update",
    entityType: "member_intake_form",
    entityId: existing.id,
    metadata: { before: existing, after: updated },
  });
  return updated;
}

export async function getIntakeForm(organizationId: string, formId: string) {
  const form = await prisma.memberIntakeForm.findFirst({
    where: { id: formId, organizationId },
    include: { fields: { orderBy: { order: "asc" } }, sources: { orderBy: { createdAt: "desc" } } },
  });
  if (!form) throw new MemberIntakeError("MEMBER_INTAKE_FORM_NOT_FOUND", "Form not found.");
  return form;
}

export async function listIntakeForms(organizationId: string) {
  return prisma.memberIntakeForm.findMany({
    where: {
      organizationId,
      NOT: { name: RESERVED_SELF_SERVICE_FORM_NAME, purpose: RESERVED_SELF_SERVICE_FORM_PURPOSE },
    },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { submissions: true, fields: true, sources: true } } },
  });
}

// ── Lifecycle (DRAFT -> ACTIVE <-> PAUSED -> ARCHIVED) ──────────────────────

const STATUS_TRANSITIONS: Record<MemberIntakeFormStatus, MemberIntakeFormStatus[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["PAUSED", "ARCHIVED"],
  PAUSED: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: [],
};

async function transitionFormStatus(
  organizationId: string,
  formId: string,
  actorUserId: string,
  nextStatus: MemberIntakeFormStatus
) {
  const form = await prisma.memberIntakeForm.findFirst({ where: { id: formId, organizationId } });
  if (!form) throw new MemberIntakeError("MEMBER_INTAKE_FORM_NOT_FOUND", "Form not found.");
  if (nextStatus === "ACTIVE" && form.name === RESERVED_SELF_SERVICE_FORM_NAME && form.purpose === RESERVED_SELF_SERVICE_FORM_PURPOSE) {
    // Defense in depth beyond just hiding it from listIntakeForms -- see the
    // reserved-name doc comment above. This form is never meant to be
    // publicly reachable, so it can never become ACTIVE even if an admin
    // somehow has its id.
    throw new MemberIntakeError("MEMBER_INTAKE_INVALID_STATUS_TRANSITION", "This form cannot be published.");
  }
  if (!STATUS_TRANSITIONS[form.status].includes(nextStatus)) {
    throw new MemberIntakeError(
      "MEMBER_INTAKE_INVALID_STATUS_TRANSITION",
      `Cannot move a form from ${form.status} to ${nextStatus}.`
    );
  }

  const updated = await prisma.memberIntakeForm.update({
    where: { id: form.id },
    data: { status: nextStatus, archivedAt: nextStatus === "ARCHIVED" ? new Date() : form.archivedAt },
  });
  await createAuditEvent({
    organizationId,
    actorUserId,
    action: "update",
    entityType: "member_intake_form",
    entityId: form.id,
    metadata: { statusFrom: form.status, statusTo: nextStatus },
  });
  return updated;
}

/** A form with zero fields has nothing for a person to submit -- refuse to
 * publish rather than shipping a broken public page. */
export async function publishIntakeForm(organizationId: string, formId: string, actorUserId: string) {
  const fieldCount = await prisma.memberIntakeFormField.count({ where: { formId } });
  if (fieldCount === 0) {
    throw new MemberIntakeError("MEMBER_INTAKE_VALIDATION_ERROR", "Add at least one field before publishing this form.");
  }
  return transitionFormStatus(organizationId, formId, actorUserId, "ACTIVE");
}

export async function pauseIntakeForm(organizationId: string, formId: string, actorUserId: string) {
  return transitionFormStatus(organizationId, formId, actorUserId, "PAUSED");
}

export async function resumeIntakeForm(organizationId: string, formId: string, actorUserId: string) {
  return transitionFormStatus(organizationId, formId, actorUserId, "ACTIVE");
}

export async function archiveIntakeForm(organizationId: string, formId: string, actorUserId: string) {
  return transitionFormStatus(organizationId, formId, actorUserId, "ARCHIVED");
}

/** "Regenerate link" -- issues a brand-new publicToken; the old one stops
 * resolving immediately since resolvePublicIntakeForm() only ever looks up
 * the CURRENT value (no denylist needed, no grace period). */
export async function regenerateIntakeFormToken(organizationId: string, formId: string, actorUserId: string) {
  const form = await prisma.memberIntakeForm.findFirst({ where: { id: formId, organizationId } });
  if (!form) throw new MemberIntakeError("MEMBER_INTAKE_FORM_NOT_FOUND", "Form not found.");

  const updated = await prisma.memberIntakeForm.update({
    where: { id: form.id },
    data: { publicToken: generateIntakeToken(), tokenVersion: { increment: 1 } },
  });
  await createAuditEvent({
    organizationId,
    actorUserId,
    action: "update",
    entityType: "member_intake_form",
    entityId: form.id,
    metadata: { event: "public_link_regenerated", tokenVersion: updated.tokenVersion },
  });
  return updated;
}

// ── Fields ───────────────────────────────────────────────────────────────

export interface IntakeFormFieldInput {
  fieldKey: string;
  label: string;
  fieldType: MemberIntakeFieldType;
  required?: boolean;
  order?: number;
  placeholder?: string | null;
  helpText?: string | null;
  options?: string[];
  targetEntity: MemberIntakeTargetEntity;
  targetField?: string | null;
  sensitivity?: MemberIntakeFieldSensitivity;
}

/** Validates targetField against the allow-list server-side, regardless of
 * what the admin UI sends -- the ONE enforcement point for §16/§25/§40's
 * "never trust target field mappings from browser" rule. A tampered/invalid
 * targetField is rejected at configuration time, so it can never reach
 * submission-application time at all. */
function resolveFieldTargeting(input: { targetEntity: MemberIntakeTargetEntity; targetField?: string | null; sensitivity?: MemberIntakeFieldSensitivity }) {
  if (input.targetEntity === "CUSTOM") {
    return { targetField: null, sensitivity: input.sensitivity ?? "LOW" };
  }
  const targetField = input.targetField ?? "";
  if (!isAllowedMemberTargetField(targetField)) {
    throw new MemberIntakeError(
      "MEMBER_INTAKE_INVALID_TARGET_FIELD",
      `"${targetField}" is not an allowed member field for a public intake form.`
    );
  }
  return { targetField, sensitivity: effectiveFieldSensitivity(targetField, input.sensitivity ?? "LOW") };
}

export async function createFormField(organizationId: string, formId: string, actorUserId: string, input: IntakeFormFieldInput) {
  const form = await prisma.memberIntakeForm.findFirst({ where: { id: formId, organizationId } });
  if (!form) throw new MemberIntakeError("MEMBER_INTAKE_FORM_NOT_FOUND", "Form not found.");

  const { targetField, sensitivity } = resolveFieldTargeting(input);
  const existing = await prisma.memberIntakeFormField.findUnique({
    where: { formId_fieldKey: { formId, fieldKey: input.fieldKey } },
  });
  if (existing) throw new MemberIntakeError("MEMBER_INTAKE_FIELD_KEY_TAKEN", `A field with key "${input.fieldKey}" already exists on this form.`);

  const field = await prisma.memberIntakeFormField.create({
    data: {
      formId,
      fieldKey: input.fieldKey,
      label: input.label,
      fieldType: input.fieldType,
      required: input.required ?? false,
      order: input.order ?? 0,
      placeholder: input.placeholder ?? null,
      helpText: input.helpText ?? null,
      options: input.options ?? [],
      targetEntity: input.targetEntity,
      targetField,
      sensitivity,
      isCustomField: input.targetEntity === "CUSTOM",
    },
  });
  await createAuditEvent({
    organizationId,
    actorUserId,
    action: "create",
    entityType: "member_intake_form_field",
    entityId: field.id,
    metadata: { formId, fieldKey: field.fieldKey, targetEntity: field.targetEntity, targetField: field.targetField },
  });
  return field;
}

export async function deleteFormField(organizationId: string, formId: string, fieldId: string, actorUserId: string) {
  const form = await prisma.memberIntakeForm.findFirst({ where: { id: formId, organizationId } });
  if (!form) throw new MemberIntakeError("MEMBER_INTAKE_FORM_NOT_FOUND", "Form not found.");
  const field = await prisma.memberIntakeFormField.findFirst({ where: { id: fieldId, formId } });
  if (!field) return;

  await prisma.memberIntakeFormField.delete({ where: { id: field.id } });
  await createAuditEvent({
    organizationId,
    actorUserId,
    action: "delete",
    entityType: "member_intake_form_field",
    entityId: field.id,
    metadata: { formId, fieldKey: field.fieldKey },
  });
}

// ── Sources (QR campaigns) ──────────────────────────────────────────────

export async function createFormSource(organizationId: string, formId: string, actorUserId: string, name: string) {
  const form = await prisma.memberIntakeForm.findFirst({ where: { id: formId, organizationId } });
  if (!form) throw new MemberIntakeError("MEMBER_INTAKE_FORM_NOT_FOUND", "Form not found.");

  const source = await prisma.memberIntakeFormSource.create({
    data: { formId, name, token: generateIntakeToken() },
  });
  await createAuditEvent({
    organizationId,
    actorUserId,
    action: "create",
    entityType: "member_intake_form_source",
    entityId: source.id,
    metadata: { formId, name: source.name },
  });
  return source;
}

export async function archiveFormSource(organizationId: string, formId: string, sourceId: string, actorUserId: string) {
  const form = await prisma.memberIntakeForm.findFirst({ where: { id: formId, organizationId } });
  if (!form) throw new MemberIntakeError("MEMBER_INTAKE_FORM_NOT_FOUND", "Form not found.");
  const source = await prisma.memberIntakeFormSource.findFirst({ where: { id: sourceId, formId } });
  if (!source) throw new MemberIntakeError("MEMBER_INTAKE_SOURCE_NOT_FOUND", "Source not found.");

  const updated = await prisma.memberIntakeFormSource.update({
    where: { id: source.id },
    data: { active: false, archivedAt: new Date() },
  });
  await createAuditEvent({
    organizationId,
    actorUserId,
    action: "update",
    entityType: "member_intake_form_source",
    entityId: source.id,
    metadata: { formId, event: "archived" },
  });
  return updated;
}

// ── Public resolution (unauthenticated path) ────────────────────────────

export interface PublicIntakeForm {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationLogoUrl: string | null;
  title: string;
  description: string | null;
  successMessage: string | null;
  fields: {
    id: string;
    fieldKey: string;
    label: string;
    fieldType: MemberIntakeFieldType;
    required: boolean;
    order: number;
    placeholder: string | null;
    helpText: string | null;
    options: string[];
  }[];
}

/**
 * ONE gate function decides whether a public token resolves to a live form
 * -- every failure mode (unknown token, DRAFT/PAUSED/ARCHIVED status,
 * expired) collapses to the same `null`, so the calling route/page returns
 * an identical 404 regardless of reason (mirrors getPublicGivingPage's
 * explicit no-tenant-enumeration discipline). Never exposes organizationId,
 * form id, or any admin-only configuration -- fields are already reduced to
 * their public-facing shape.
 *
 * Deliberately does NOT take a source/campaign token: a forged or foreign
 * one must never affect whether the base form resolves (attribution is
 * best-effort, not a security gate) -- see resolvePublicIntakeSourceId
 * below, called separately and only at submission-record time.
 */
export async function resolvePublicIntakeForm(publicToken: string): Promise<PublicIntakeForm | null> {
  const form = await prisma.memberIntakeForm.findUnique({
    where: { publicToken },
    include: {
      organization: { select: { id: true, name: true, logoUrl: true } },
      fields: { orderBy: { order: "asc" } },
    },
  });
  if (!form) return null;
  if (form.status !== "ACTIVE") return null;
  if (form.expiresAt && form.expiresAt < new Date()) return null;

  return {
    id: form.id,
    organizationId: form.organizationId,
    organizationName: form.organization.name,
    organizationLogoUrl: form.organization.logoUrl,
    title: form.title,
    description: form.description,
    successMessage: form.successMessage,
    fields: form.fields.map((f) => ({
      id: f.id,
      fieldKey: f.fieldKey,
      label: f.label,
      fieldType: f.fieldType,
      required: f.required,
      order: f.order,
      placeholder: f.placeholder,
      helpText: f.helpText,
      options: f.options,
    })),
  };
}

/** Companion resolver used once a submission is being recorded (needs the
 * resolved sourceId as a real id, not just whether it was valid) -- kept
 * separate from resolvePublicIntakeForm's public-shape return so the public
 * page/route never has to know about internal ids at all. */
export async function resolvePublicIntakeSourceId(formId: string, sourceToken?: string | null): Promise<string | null> {
  if (!sourceToken) return null;
  const source = await prisma.memberIntakeFormSource.findFirst({
    where: { token: sourceToken, formId, active: true },
    select: { id: true },
  });
  return source?.id ?? null;
}
