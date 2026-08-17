import { prisma } from "@/lib/prisma";
import type { OrganizationVertical, MemberIntakeFieldType, MemberIntakeTargetEntity, MemberIntakeFormPurpose } from "@prisma/client";
import { createIntakeForm, createFormField, getIntakeForm, type IntakeFormFieldInput } from "./forms";
import type { AllowedMemberTargetField } from "./sensitivity";

/**
 * Member Intake & Profile Update (MEMBER-QR-H) — vertical form presets. §31's
 * "Organizations may not need to build every form manually": one reusable
 * engine (forms.ts/submissions.ts/matching.ts/update-engine.ts, all vertical-
 * agnostic already), presented as a distinct starting point per vertical.
 * Presets only ever create a DRAFT form (never auto-publish, never touch an
 * existing form) — instantiating one is an explicit admin action, same
 * discipline as §37's "must not modify existing data merely by being
 * deployed." Every created field remains individually editable afterward
 * through the existing field manager (MEMBER-QR-B) — "Presets should be
 * editable," not a locked template.
 *
 * Deliberate scope boundary: PTA's preset maps to the generic OrgMember
 * fields only (via ALLOWED_MEMBER_TARGET_FIELDS), the same as every other
 * vertical. It does NOT attempt to resolve a submission against an existing
 * PtaHousehold/PtaHouseholdAdult record — that would require extending
 * matching.ts and update-engine.ts with a second, structurally different
 * matching target (a household+adult pair, not a single OrgMember row) and
 * is a materially larger change than a field preset. Flagged as a known,
 * real gap for a future milestone rather than silently building a shallow
 * version of it here.
 */

interface IntakeFieldPreset {
  fieldKey: string;
  label: string;
  fieldType: MemberIntakeFieldType;
  required?: boolean;
  targetEntity: MemberIntakeTargetEntity;
  targetField?: AllowedMemberTargetField;
  options?: string[];
  helpText?: string;
}

export interface IntakeFormPreset {
  name: string;
  purpose: MemberIntakeFormPurpose;
  title: string;
  description: string;
  successMessage: string;
  fields: IntakeFieldPreset[];
  /**
   * Whether a genuine NO_MATCH submission through this preset should create
   * a member automatically rather than wait in the review queue. Found live
   * (2026-08-17, first real production use) that every preset previously
   * left this unset and silently inherited createIntakeForm()'s own
   * blanket-conservative default (false) -- correct for a hand-built form
   * an admin configures from scratch, but wrong for a preset whose whole
   * purpose IS "join us." Each preset below sets this explicitly, by
   * product intent per vertical, not by omission:
   *   - COMMUNITY/HOA: true -- an unambiguous "join our organization" /
   *     "register as a resident" intent; a genuine no-match is exactly the
   *     case this preset exists for.
   *   - CHURCH: false -- this preset is a visitor CONNECTION CARD
   *     (VISITOR_CONNECT), not a formal membership application. Becoming a
   *     visitor must never silently become becoming a member.
   *   - UNION: false -- this preset is a CONTACT UPDATE for people already
   *     assumed to be members, and union membership eligibility is
   *     controlled by roster/employment data this form never sees. A
   *     public form must never be able to originate official membership.
   *   - PTA: false -- this preset deliberately maps to generic OrgMember
   *     fields only, not PtaHousehold/PtaHouseholdAdult (see this file's
   *     top doc comment); auto-creating a bare member record here would
   *     bypass the real household model rather than respect it.
   */
  autoCreateNewMember: boolean;
}

const NAME_FIELDS: IntakeFieldPreset[] = [
  { fieldKey: "firstName", label: "First name", fieldType: "TEXT", required: true, targetEntity: "MEMBER", targetField: "firstName" },
  { fieldKey: "lastName", label: "Last name", fieldType: "TEXT", required: true, targetEntity: "MEMBER", targetField: "lastName" },
];

const EMAIL_PHONE_FIELDS: IntakeFieldPreset[] = [
  { fieldKey: "email", label: "Email", fieldType: "EMAIL", targetEntity: "MEMBER", targetField: "email" },
  { fieldKey: "phone", label: "Mobile phone", fieldType: "PHONE", targetEntity: "MEMBER", targetField: "phone" },
];

const HOME_ADDRESS_FIELDS: IntakeFieldPreset[] = [
  { fieldKey: "addressLine1", label: "Street address", fieldType: "ADDRESS", targetEntity: "MEMBER", targetField: "addressLine1" },
  { fieldKey: "city", label: "City", fieldType: "TEXT", targetEntity: "MEMBER", targetField: "city" },
  { fieldKey: "state", label: "State", fieldType: "TEXT", targetEntity: "MEMBER", targetField: "state" },
  { fieldKey: "zipCode", label: "ZIP code", fieldType: "TEXT", targetEntity: "MEMBER", targetField: "zipCode" },
];

const COMMS_PREFERENCE_FIELDS: IntakeFieldPreset[] = [
  { fieldKey: "commsEmailEnabled", label: "Email me updates", fieldType: "BOOLEAN", targetEntity: "MEMBER", targetField: "commsEmailEnabled" },
  { fieldKey: "commsSmsEnabled", label: "Text me updates", fieldType: "BOOLEAN", targetEntity: "MEMBER", targetField: "commsSmsEnabled" },
];

const PRESETS: Record<OrganizationVertical, IntakeFormPreset> = {
  COMMUNITY: {
    name: "Join / Update Membership",
    purpose: "NEW_OR_UPDATE",
    title: "Join Our Organization",
    description: "Tell us a bit about yourself to join or update your membership information.",
    successMessage: "Thank you! We've received your information.",
    autoCreateNewMember: true,
    fields: [
      ...NAME_FIELDS,
      ...EMAIL_PHONE_FIELDS,
      ...HOME_ADDRESS_FIELDS,
      { fieldKey: "membershipCategory", label: "Membership type", fieldType: "SELECT", targetEntity: "CUSTOM", options: ["General Member", "Associate", "Honorary"] },
      { fieldKey: "interests", label: "What committees or activities are you interested in?", fieldType: "TEXTAREA", targetEntity: "CUSTOM" },
      ...COMMS_PREFERENCE_FIELDS,
    ],
  },
  PTA: {
    name: "Join / Update Family Information",
    purpose: "HOUSEHOLD_UPDATE",
    title: "PTA/PTO Family Information",
    description: "Share your family's information to join or update your household's PTA/PTO record.",
    successMessage: "Thank you! Your family's information has been received.",
    autoCreateNewMember: false,
    fields: [
      ...NAME_FIELDS,
      ...EMAIL_PHONE_FIELDS,
      ...HOME_ADDRESS_FIELDS,
      { fieldKey: "students", label: "Student name(s) and grade", fieldType: "TEXTAREA", targetEntity: "CUSTOM", helpText: "e.g. Jamie Rivera, Grade 3" },
      { fieldKey: "teacherHomeroom", label: "Teacher / homeroom", fieldType: "TEXT", targetEntity: "CUSTOM" },
      {
        fieldKey: "volunteerInterests",
        label: "Volunteer interests",
        fieldType: "MULTISELECT",
        targetEntity: "CUSTOM",
        options: ["Classroom helper", "Fundraising", "Event planning", "Book Fair", "Field trip chaperone", "Board / Committee"],
      },
      ...COMMS_PREFERENCE_FIELDS,
    ],
  },
  UNION: {
    name: "Update My Membership Information",
    purpose: "CONTACT_UPDATE",
    title: "Union Member Contact Update",
    description: "Keep your union contact and worksite information up to date.",
    successMessage: "Thank you! Your information has been received.",
    autoCreateNewMember: false,
    fields: [
      ...NAME_FIELDS,
      { fieldKey: "email", label: "Personal email (not your work email)", fieldType: "EMAIL", targetEntity: "MEMBER", targetField: "email" },
      { fieldKey: "phone", label: "Mobile phone", fieldType: "PHONE", targetEntity: "MEMBER", targetField: "phone" },
      ...HOME_ADDRESS_FIELDS,
      { fieldKey: "employer", label: "Employer", fieldType: "TEXT", targetEntity: "CUSTOM" },
      { fieldKey: "worksite", label: "Worksite", fieldType: "TEXT", targetEntity: "CUSTOM" },
      { fieldKey: "classification", label: "Job title / classification", fieldType: "TEXT", targetEntity: "CUSTOM" },
      { fieldKey: "department", label: "Department", fieldType: "TEXT", targetEntity: "CUSTOM" },
      ...COMMS_PREFERENCE_FIELDS,
    ],
  },
  HOA: {
    name: "Resident Information",
    purpose: "NEW_OR_UPDATE",
    title: "Resident Information",
    description: "Share your contact and property information with the association.",
    successMessage: "Thank you! Your information has been received.",
    autoCreateNewMember: true,
    fields: [
      ...NAME_FIELDS,
      ...EMAIL_PHONE_FIELDS,
      { fieldKey: "addressLine1", label: "Property address", fieldType: "ADDRESS", required: true, targetEntity: "MEMBER", targetField: "addressLine1" },
      { fieldKey: "city", label: "City", fieldType: "TEXT", targetEntity: "MEMBER", targetField: "city" },
      { fieldKey: "state", label: "State", fieldType: "TEXT", targetEntity: "MEMBER", targetField: "state" },
      { fieldKey: "zipCode", label: "ZIP code", fieldType: "TEXT", targetEntity: "MEMBER", targetField: "zipCode" },
      { fieldKey: "propertyUnit", label: "Unit / lot number", fieldType: "TEXT", targetEntity: "CUSTOM" },
      { fieldKey: "moveInDate", label: "Move-in date", fieldType: "DATE", targetEntity: "CUSTOM" },
      ...COMMS_PREFERENCE_FIELDS,
    ],
  },
  CHURCH: {
    name: "Connect With Our Church",
    purpose: "VISITOR_CONNECT",
    title: "Connect With Our Church",
    description: "We'd love to get to know you. Share your information so we can stay connected.",
    successMessage: "Thank you for connecting with us! We look forward to staying in touch.",
    autoCreateNewMember: false,
    fields: [
      ...NAME_FIELDS,
      ...EMAIL_PHONE_FIELDS,
      ...HOME_ADDRESS_FIELDS,
      { fieldKey: "householdName", label: "Household / family name", fieldType: "TEXT", targetEntity: "MEMBER", targetField: "householdName" },
      {
        fieldKey: "visitorStatus",
        label: "Which best describes you?",
        fieldType: "SELECT",
        targetEntity: "CUSTOM",
        options: ["First-time visitor", "Regular attendee", "Prospective member", "Member"],
      },
      {
        fieldKey: "ministryInterests",
        label: "Ministry interests",
        fieldType: "MULTISELECT",
        targetEntity: "CUSTOM",
        options: ["Worship", "Children's Ministry", "Youth Ministry", "Small Groups", "Outreach & Missions", "Hospitality", "Music / Worship Team"],
      },
      ...COMMS_PREFERENCE_FIELDS,
    ],
  },
};

export function getIntakeFormPreset(vertical: OrganizationVertical): IntakeFormPreset {
  return PRESETS[vertical];
}

export function listIntakeFormPresets(): { vertical: OrganizationVertical; preset: IntakeFormPreset }[] {
  return (Object.keys(PRESETS) as OrganizationVertical[]).map((vertical) => ({ vertical, preset: PRESETS[vertical] }));
}

/**
 * Instantiates a preset as a brand-new DRAFT form (never published
 * automatically -- an admin still reviews and publishes it, same as any
 * hand-built form). Field creation goes through the same createFormField()
 * used everywhere else, so the allow-list/sensitivity enforcement in
 * sensitivity.ts applies identically -- a preset is just a fast way to reach
 * a normal, fully-editable form, not a separate code path.
 */
export async function createFormFromPreset(organizationId: string, actorUserId: string, vertical: OrganizationVertical) {
  const preset = getIntakeFormPreset(vertical);
  const form = await createIntakeForm(organizationId, actorUserId, {
    name: preset.name,
    purpose: preset.purpose,
    title: preset.title,
    description: preset.description,
    successMessage: preset.successMessage,
    autoCreateNewMember: preset.autoCreateNewMember,
  });

  for (const [index, fieldPreset] of preset.fields.entries()) {
    const input: IntakeFormFieldInput = {
      fieldKey: fieldPreset.fieldKey,
      label: fieldPreset.label,
      fieldType: fieldPreset.fieldType,
      required: fieldPreset.required ?? false,
      order: index,
      helpText: fieldPreset.helpText ?? null,
      options: fieldPreset.options ?? [],
      targetEntity: fieldPreset.targetEntity,
      targetField: fieldPreset.targetField ?? null,
    };
    await createFormField(organizationId, form.id, actorUserId, input);
  }

  return getIntakeForm(organizationId, form.id);
}

/** Resolves the organization's own vertical for the "recommended preset"
 * default -- never trusted from the client, always read fresh. An admin may
 * still explicitly request a different vertical's preset (e.g. previewing
 * before switching), which is why createFormFromPreset takes vertical as an
 * explicit param rather than always resolving it internally. */
export async function getOrganizationVertical(organizationId: string): Promise<OrganizationVertical> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { primaryVertical: true } });
  return org.primaryVertical;
}
