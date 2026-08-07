import { prisma } from "@/lib/prisma";
import { checkMemberLimit } from "@/lib/plan-gate";
import { buildFieldGetter, type ImportRowResult } from "@/lib/member-import";
import { createPtaHousehold, addPtaHouseholdAdult, addPtaStudent } from "@/lib/labs/pta/households";
import { PtaError } from "@/lib/labs/pta/errors";
import { createProperty, assignPropertyResident } from "@/lib/hoa/properties";
import { HoaError } from "@/lib/hoa/errors";
import { parseImportEmail } from "@/lib/email";

/**
 * Vertical-specific CSV/Excel/SQLite bulk-import support, layered onto the
 * existing generic importer (member-import.ts, src/app/api/import/route.ts).
 * Kept in its own module for the same reason member-import.ts is: Next.js's
 * App Router route type-checking only permits a fixed set of exports from a
 * route.ts file.
 *
 * Both functions here deliberately call the same service-layer functions the
 * officer-facing single-record UI uses (createPtaHousehold/addPtaHouseholdAdult,
 * createProperty/assignPropertyResident) rather than writing raw Prisma calls
 * — this reuses their validation, audit-event logging, and tenant scoping
 * instead of re-deriving it, and keeps CSV-imported records indistinguishable
 * from records created one at a time in the UI.
 */

// ─── PTA households ─────────────────────────────────────────────────────────

/**
 * One row = one household + its primary contact adult, optionally with
 * students. Matched for idempotent re-import by the same (organizationId,
 * displayName, schoolYear) key PtaHousehold itself is uniquely constrained
 * on — an already-imported household is treated as "ok" (no-op), not
 * duplicated and not updated, mirroring how migration-import.ts treats an
 * already-matched Event/Meeting on re-import.
 */
export async function importPtaHouseholds(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  organizationId: string,
  actorUserId: string,
  actorEmail: string | null,
  preview: boolean
): Promise<ImportRowResult[]> {
  const results: ImportRowResult[] = [];
  const getField = buildFieldGetter(mapping);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const get = (field: string) => getField(row, field);

    const householdName = get("householdName");
    const schoolYear = get("schoolYear");
    const contactName = get("contactName");

    if (!householdName) {
      results.push({ row: i + 2, status: "error", message: "Household name is required" });
      continue;
    }
    if (!schoolYear) {
      results.push({ row: i + 2, status: "error", message: "School year is required" });
      continue;
    }
    if (!contactName) {
      results.push({ row: i + 2, status: "error", message: "Primary contact name is required" });
      continue;
    }

    const { email: contactEmail, error: contactEmailError } = parseImportEmail(get("contactEmail"));
    if (contactEmailError) {
      results.push({ row: i + 2, status: "error", message: contactEmailError });
      continue;
    }

    if (preview) {
      results.push({ row: i + 2, status: "ok" });
      continue;
    }

    try {
      // Only skip re-creating a household if it already has a primary
      // contact -- createPtaHousehold/addPtaHouseholdAdult/addPtaStudent are
      // separate, non-transactional calls (they're the same shared
      // service-layer functions the officer UI uses, which take the module
      // prisma client directly rather than a passed-in transaction client),
      // so a failure between them can leave a household with no primary
      // contact. Checking only "does a household with this name exist"
      // would treat that partial row as permanently done on re-import --
      // the row would report "ok" forever without ever getting a contact.
      const existing = await prisma.ptaHousehold.findFirst({
        where: { organizationId, displayName: householdName, schoolYear },
        select: { id: true, primaryContactAdultId: true },
      });
      if (existing?.primaryContactAdultId) {
        results.push({ row: i + 2, status: "ok" });
        continue;
      }

      const household =
        existing ??
        (await createPtaHousehold({
          organizationId,
          displayName: householdName,
          schoolYear,
          notes: get("notes") || null,
          actorUserId,
          actorEmail,
        }));

      await addPtaHouseholdAdult({
        organizationId,
        householdId: household.id,
        name: contactName,
        email: contactEmail,
        phone: get("contactPhone") || null,
        makePrimaryContact: true,
        actorUserId,
        actorEmail,
      });

      const studentNames = get("studentNames")
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const displayName of studentNames) {
        // Idempotent per student name -- addPtaStudent itself has no dedup
        // check (each call always creates a new row), so a retried row
        // with some students already added from a prior partial failure
        // would otherwise duplicate them.
        const existingStudent = await prisma.ptaStudent.findFirst({ where: { householdId: household.id, displayName }, select: { id: true } });
        if (!existingStudent) {
          await addPtaStudent({ organizationId, householdId: household.id, displayName, actorUserId, actorEmail });
        }
      }

      results.push({ row: i + 2, status: "ok" });
    } catch (err) {
      const message = err instanceof PtaError ? err.message : String(err);
      results.push({ row: i + 2, status: "error", message });
    }
  }

  return results;
}

// ─── HOA properties ──────────────────────────────────────────────────────────

const PROPERTY_TYPE_ALIASES: Record<string, string> = {
  "single family": "SINGLE_FAMILY", "single-family": "SINGLE_FAMILY", "single_family": "SINGLE_FAMILY",
  "sfh": "SINGLE_FAMILY", "house": "SINGLE_FAMILY",
  "condo": "CONDO_UNIT", "condo unit": "CONDO_UNIT", "condominium": "CONDO_UNIT",
  "townhome": "TOWNHOME", "townhouse": "TOWNHOME",
  "vacant lot": "VACANT_LOT", "lot": "VACANT_LOT", "land": "VACANT_LOT",
  "common property": "COMMON_PROPERTY", "common area": "COMMON_PROPERTY", "clubhouse": "COMMON_PROPERTY",
  "other": "OTHER",
};

export function mapPropertyType(raw: string): "SINGLE_FAMILY" | "CONDO_UNIT" | "TOWNHOME" | "VACANT_LOT" | "COMMON_PROPERTY" | "OTHER" {
  const key = raw.toLowerCase().trim();
  return (PROPERTY_TYPE_ALIASES[key] as never) ?? "SINGLE_FAMILY";
}

const RELATIONSHIP_TYPE_ALIASES: Record<string, string> = {
  owner: "OWNER", "co-owner": "CO_OWNER", "co owner": "CO_OWNER", coowner: "CO_OWNER",
  resident: "RESIDENT", tenant: "TENANT", renter: "TENANT",
  "non-resident owner": "NON_RESIDENT_OWNER", "non resident owner": "NON_RESIDENT_OWNER",
  other: "OTHER",
};

export function mapRelationshipType(raw: string): "OWNER" | "CO_OWNER" | "RESIDENT" | "TENANT" | "NON_RESIDENT_OWNER" | "OTHER" {
  const key = raw.toLowerCase().trim();
  return (RELATIONSHIP_TYPE_ALIASES[key] as never) ?? "OWNER";
}

/**
 * One row = one property, optionally with one owner/resident. Properties are
 * matched for idempotent re-import by (organizationId, addressLine1,
 * unitLabel) — Property has no unique DB constraint on address (unlike
 * PtaHousehold), so this is an application-level dedup check, same pattern
 * migration-import.ts uses for Event/Meeting.
 *
 * The owner, when present, is matched-or-created as a real OrgMember (never
 * a lighter-weight record) — this mirrors both the officer UI's
 * AssignResidentForm (which links an existing OrgMember) and HOA's own
 * architecture decision that every resident/owner is a full OrgMember (see
 * docs/hoa-domain-model.md) — so new owners created here count against the
 * organization's plan member limit exactly as manually adding one would.
 */
export async function importHoaProperties(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  organizationId: string,
  actorUserId: string,
  actorEmail: string | null,
  preview: boolean
): Promise<ImportRowResult[]> {
  const results: ImportRowResult[] = [];

  const memberLimit = preview ? null : await checkMemberLimit(organizationId);
  let newMemberCount = memberLimit?.current ?? 0;
  const getField = buildFieldGetter(mapping);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const get = (field: string) => getField(row, field);

    const addressLine1 = get("addressLine1");
    if (!addressLine1) {
      results.push({ row: i + 2, status: "error", message: "Street address is required" });
      continue;
    }

    const { email: ownerEmail, error: ownerEmailError } = parseImportEmail(get("ownerEmail"));
    if (ownerEmailError) {
      results.push({ row: i + 2, status: "error", message: ownerEmailError });
      continue;
    }

    if (preview) {
      results.push({ row: i + 2, status: "ok" });
      continue;
    }

    try {
      const unitLabel = get("unitLabel") || null;
      let property = await prisma.property.findFirst({
        where: { organizationId, addressLine1, unitLabel },
        select: { id: true },
      });

      if (!property) {
        property = await createProperty({
          organizationId,
          addressLine1,
          addressLine2: get("addressLine2") || null,
          city: get("city") || null,
          state: get("state") || null,
          zipCode: get("zip") || null,
          unitLabel,
          buildingLabel: get("buildingLabel") || null,
          propertyType: mapPropertyType(get("propertyType")),
          notes: get("notes") || null,
          actorUserId,
          actorEmail,
        });
      }

      const ownerFirstName = get("ownerFirstName");
      const ownerLastName = get("ownerLastName");
      if (ownerFirstName || ownerLastName) {
        const existingMember = ownerEmail
          ? await prisma.orgMember.findFirst({ where: { organizationId, email: ownerEmail }, select: { id: true } })
          : null;

        let memberId: string;
        if (existingMember) {
          memberId = existingMember.id;
        } else {
          if (memberLimit && newMemberCount >= memberLimit.limit) {
            results.push({
              row: i + 2,
              status: "error",
              message: `Property created, but owner not linked — member limit reached (${memberLimit.limit}). Upgrade your plan and re-run the import to link remaining owners.`,
            });
            continue;
          }
          const created = await prisma.orgMember.create({
            data: {
              organizationId,
              firstName: ownerFirstName || "Unknown",
              lastName: ownerLastName || "Unknown",
              email: ownerEmail,
            },
            select: { id: true },
          });
          memberId = created.id;
          newMemberCount++;
        }

        const existingRelationship = await prisma.propertyResident.findFirst({
          where: { organizationId, propertyId: property.id, orgMemberId: memberId, status: "ACTIVE" },
          select: { id: true },
        });
        if (!existingRelationship) {
          await assignPropertyResident({
            organizationId,
            propertyId: property.id,
            orgMemberId: memberId,
            relationshipType: mapRelationshipType(get("relationshipType")),
            isPrimaryContact: true,
            actorUserId,
            actorEmail,
          });
        }
      }

      results.push({ row: i + 2, status: "ok" });
    } catch (err) {
      const message = err instanceof HoaError ? err.message : String(err);
      results.push({ row: i + 2, status: "error", message });
    }
  }

  return results;
}
