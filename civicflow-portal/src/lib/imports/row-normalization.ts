import { createHash } from "crypto";
import type { ImportKind } from "@prisma/client";
import { buildFieldGetter, parseDate } from "@/lib/member-import";
import { parseImportEmail } from "@/lib/email";
import { mapPropertyType, mapRelationshipType } from "@/lib/vertical-import";

/**
 * Resumable Import Program (PR A) — row normalization for Community member
 * imports. Reuses src/lib/member-import.ts's pickStr/buildFieldGetter/
 * parseDate directly rather than re-implementing them — same column-mapping
 * direction, same date-parsing behavior as the existing /api/import path.
 *
 * PR C adds sibling normalizers for PTA households and HOA properties,
 * reusing the exact field keys already shipped in ImportPageClient.tsx's
 * FIELD_DEFS for those two types, and the exact propertyType/relationshipType
 * alias-mapping functions vertical-import.ts's importHoaProperties() already
 * uses — not reinvented.
 */

export interface NormalizedMemberRow {
  firstName: string;
  lastName: string;
  email: string | null;
  emailError: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  joinDate: Date | null;
}

export function normalizeMemberRow(row: Record<string, string>, mapping: Record<string, string>): NormalizedMemberRow {
  const getField = buildFieldGetter(mapping);
  const get = (field: string) => getField(row, field);

  const { email, error: emailError } = parseImportEmail(get("email"));

  return {
    firstName: get("firstName"),
    lastName: get("lastName"),
    email: email ?? null,
    emailError: emailError ?? null,
    phone: get("phone") || null,
    addressLine1: get("address") || null,
    city: get("city") || null,
    state: get("state") || null,
    zipCode: get("zip") || null,
    joinDate: parseDate(get("joinDate")),
  };
}

/**
 * sha256 of the normalized identifying fields — a deterministic fingerprint
 * for this row's real-world identity, independent of column order or
 * incidental whitespace. Not currently unique-constrained (PR B's matching-
 * hierarchy job); computed now so PR B doesn't need a migration to start
 * using it.
 */
export function computeRowFingerprint(normalized: NormalizedMemberRow): string {
  const identity = {
    firstName: normalized.firstName.toLowerCase(),
    lastName: normalized.lastName.toLowerCase(),
    email: normalized.email?.toLowerCase() ?? null,
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

// ─── PTA households ─────────────────────────────────────────────────────────

export interface NormalizedPtaHouseholdRow {
  householdName: string;
  schoolYear: string;
  contactName: string;
  contactEmail: string | null;
  contactEmailError: string | null;
  contactPhone: string | null;
  studentNames: string[];
  notes: string | null;
}

/** Field keys match ImportPageClient.tsx's FIELD_DEFS["pta-households"]
 * exactly (householdName/schoolYear/contactName/contactEmail/contactPhone/
 * studentNames/notes) — same student-name split convention (semicolon or
 * comma) as importPtaHouseholds() (vertical-import.ts). */
export function normalizePtaHouseholdRow(row: Record<string, string>, mapping: Record<string, string>): NormalizedPtaHouseholdRow {
  const getField = buildFieldGetter(mapping);
  const get = (field: string) => getField(row, field);

  const { email: contactEmail, error: contactEmailError } = parseImportEmail(get("contactEmail"));
  const studentNames = get("studentNames")
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    householdName: get("householdName"),
    schoolYear: get("schoolYear"),
    contactName: get("contactName"),
    contactEmail: contactEmail ?? null,
    contactEmailError: contactEmailError ?? null,
    contactPhone: get("contactPhone") || null,
    studentNames,
    notes: get("notes") || null,
  };
}

export function computePtaHouseholdFingerprint(normalized: NormalizedPtaHouseholdRow): string {
  const identity = {
    householdName: normalized.householdName.toLowerCase(),
    schoolYear: normalized.schoolYear.toLowerCase(),
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

// ─── HOA properties ──────────────────────────────────────────────────────────

export interface NormalizedHoaPropertyRow {
  addressLine1: string;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  unitLabel: string | null;
  buildingLabel: string | null;
  propertyType: "SINGLE_FAMILY" | "CONDO_UNIT" | "TOWNHOME" | "VACANT_LOT" | "COMMON_PROPERTY" | "OTHER" | null;
  ownerFirstName: string | null;
  ownerLastName: string | null;
  ownerEmail: string | null;
  ownerEmailError: string | null;
  relationshipType: "OWNER" | "CO_OWNER" | "RESIDENT" | "TENANT" | "NON_RESIDENT_OWNER" | "OTHER" | null;
  notes: string | null;
}

/** Field keys match ImportPageClient.tsx's FIELD_DEFS["hoa-properties"]
 * exactly. propertyType/relationshipType are pre-mapped to their real enum
 * values here (via vertical-import.ts's mapPropertyType/mapRelationshipType)
 * so downstream matching/creation never re-parses raw alias strings. */
export function normalizeHoaPropertyRow(row: Record<string, string>, mapping: Record<string, string>): NormalizedHoaPropertyRow {
  const getField = buildFieldGetter(mapping);
  const get = (field: string) => getField(row, field);

  const { email: ownerEmail, error: ownerEmailError } = parseImportEmail(get("ownerEmail"));
  const rawPropertyType = get("propertyType");
  const rawRelationshipType = get("relationshipType");

  return {
    addressLine1: get("addressLine1"),
    addressLine2: get("addressLine2") || null,
    city: get("city") || null,
    state: get("state") || null,
    zipCode: get("zip") || null,
    unitLabel: get("unitLabel") || null,
    buildingLabel: get("buildingLabel") || null,
    propertyType: rawPropertyType ? mapPropertyType(rawPropertyType) : null,
    ownerFirstName: get("ownerFirstName") || null,
    ownerLastName: get("ownerLastName") || null,
    ownerEmail: ownerEmail ?? null,
    ownerEmailError: ownerEmailError ?? null,
    relationshipType: rawRelationshipType ? mapRelationshipType(rawRelationshipType) : null,
    notes: get("notes") || null,
  };
}

export function computeHoaPropertyFingerprint(normalized: NormalizedHoaPropertyRow): string {
  const identity = {
    addressLine1: normalized.addressLine1.toLowerCase(),
    unitLabel: normalized.unitLabel?.toLowerCase() ?? null,
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

/**
 * The review UI's "Name"/"Email" row-summary columns are kind-agnostic
 * display strings, computed once here rather than the client component
 * parsing raw normalizedData shapes that differ per kind.
 */
export function formatRowIdentity(
  importKind: ImportKind,
  normalizedData: unknown
): { displayName: string; displaySubtitle: string | null } {
  if (importKind === "PTA_HOUSEHOLDS") {
    const row = normalizedData as NormalizedPtaHouseholdRow;
    return { displayName: row.householdName || "(no household name)", displaySubtitle: row.contactName || null };
  }
  if (importKind === "HOA_PROPERTIES") {
    const row = normalizedData as NormalizedHoaPropertyRow;
    return {
      displayName: row.addressLine1 ? `${row.addressLine1}${row.unitLabel ? ` Unit ${row.unitLabel}` : ""}` : "(no address)",
      displaySubtitle: [row.ownerFirstName, row.ownerLastName].filter(Boolean).join(" ") || null,
    };
  }
  const row = normalizedData as NormalizedMemberRow;
  return { displayName: `${row.firstName} ${row.lastName}`.trim() || "(no name)", displaySubtitle: row.email || null };
}
