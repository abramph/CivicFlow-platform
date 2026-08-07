/**
 * Shared column-mapping field definitions for every bulk-import UI type —
 * the old `/import` page (ImportPageClient.tsx) and the new resumable
 * engine's upload form (ImportUploadForm.tsx) both import from here rather
 * than each keeping their own copy, so the two pathways never drift apart on
 * what a "Household Name" or "Street Address" column is called or aliased
 * to. Field keys and required-ness for pta-households/hoa-properties match
 * importPtaHouseholds()/importHoaProperties() (src/lib/vertical-import.ts)
 * and their new-engine equivalents (src/lib/imports/row-normalization.ts)
 * exactly.
 */
import type { CapabilityFlag } from "@/lib/vertical-capabilities";

export type ImportType = "members" | "contributions" | "pta-households" | "hoa-properties";

export const IMPORT_TYPES: { id: ImportType; label: string; desc: string; capability?: CapabilityFlag }[] = [
  { id: "members", label: "Members", desc: "Import or update member records. Matched by email if provided." },
  { id: "contributions", label: "Contributions", desc: "Import contribution/donation records. Matched to members by email." },
  {
    id: "pta-households",
    label: "PTA Households",
    desc: "Import households with a primary contact adult and optional students.",
    capability: "ptaHouseholds",
  },
  {
    id: "hoa-properties",
    label: "HOA Properties",
    desc: "Import properties, optionally with an owner or resident linked to each one.",
    capability: "properties",
  },
];

export const FIELD_DEFS: Record<ImportType, { key: string; label: string; required: boolean }[]> = {
  members: [
    { key: "firstName", label: "First Name", required: true },
    { key: "lastName", label: "Last Name", required: true },
    { key: "email", label: "Email", required: false },
    { key: "phone", label: "Phone", required: false },
    { key: "joinDate", label: "Join Date", required: false },
    { key: "address", label: "Street Address", required: false },
    { key: "city", label: "City", required: false },
    { key: "state", label: "State", required: false },
    { key: "zip", label: "ZIP Code", required: false },
  ],
  contributions: [
    { key: "amount", label: "Amount", required: true },
    { key: "contributionDate", label: "Contribution Date", required: true },
    { key: "memberEmail", label: "Member Email (for matching)", required: false },
    { key: "paymentMethod", label: "Payment Method", required: false },
    { key: "notes", label: "Notes", required: false },
  ],
  "pta-households": [
    { key: "householdName", label: "Household Name", required: true },
    { key: "schoolYear", label: "School Year", required: true },
    { key: "contactName", label: "Primary Contact Name", required: true },
    { key: "contactEmail", label: "Primary Contact Email", required: false },
    { key: "contactPhone", label: "Primary Contact Phone", required: false },
    { key: "studentNames", label: "Student Names (semicolon-separated)", required: false },
    { key: "notes", label: "Notes", required: false },
  ],
  "hoa-properties": [
    { key: "addressLine1", label: "Street Address", required: true },
    { key: "addressLine2", label: "Address Line 2", required: false },
    { key: "unitLabel", label: "Unit / Lot Number", required: false },
    { key: "buildingLabel", label: "Building", required: false },
    { key: "city", label: "City", required: false },
    { key: "state", label: "State", required: false },
    { key: "zip", label: "ZIP Code", required: false },
    { key: "propertyType", label: "Property Type", required: false },
    { key: "ownerFirstName", label: "Owner First Name", required: false },
    { key: "ownerLastName", label: "Owner Last Name", required: false },
    { key: "ownerEmail", label: "Owner Email", required: false },
    { key: "relationshipType", label: "Relationship Type", required: false },
    { key: "notes", label: "Notes (board-only)", required: false },
  ],
};

export const COMMON_ALIASES: Record<string, string> = {
  "first name": "firstName", "first_name": "firstName", "firstname": "firstName",
  "last name": "lastName", "last_name": "lastName", "lastname": "lastName",
  "email": "email", "email address": "email", "e-mail": "email",
  "phone": "phone", "phone number": "phone", "mobile": "phone",
  "join date": "joinDate", "joined": "joinDate", "join_date": "joinDate",
  "address": "address", "street": "address", "street address": "address",
  "city": "city", "state": "state", "zip": "zip", "zip code": "zip", "postal code": "zip",
  "amount": "amount", "donation": "amount", "contribution": "amount",
  "date": "contributionDate", "contribution date": "contributionDate", "donation date": "contributionDate",
  "member email": "memberEmail", "donor email": "memberEmail",
  "payment method": "paymentMethod", "method": "paymentMethod",
  "notes": "notes", "note": "notes", "memo": "notes",
  "household name": "householdName", "household": "householdName", "family name": "householdName",
  "school year": "schoolYear",
  "contact name": "contactName", "primary contact": "contactName", "parent name": "contactName",
  "contact email": "contactEmail", "parent email": "contactEmail",
  "contact phone": "contactPhone", "parent phone": "contactPhone",
  "student names": "studentNames", "students": "studentNames", "student name": "studentNames",
  "address line 1": "addressLine1", "property address": "addressLine1",
  "address line 2": "addressLine2", "address 2": "addressLine2",
  "unit": "unitLabel", "unit number": "unitLabel", "lot": "unitLabel", "lot number": "unitLabel",
  "building": "buildingLabel",
  "property type": "propertyType", "type": "propertyType",
  "owner first name": "ownerFirstName", "owner last name": "ownerLastName", "owner email": "ownerEmail",
  "relationship": "relationshipType", "relationship type": "relationshipType",
};
