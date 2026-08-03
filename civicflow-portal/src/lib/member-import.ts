import { prisma } from "@/lib/prisma";
import { checkMemberLimit } from "@/lib/plan-gate";
import { parseImportEmail } from "@/lib/email";

/**
 * Bulk member-import logic shared by the CSV/Excel/SQLite importer
 * (src/app/api/import/route.ts). Kept in its own module (rather than
 * defined inline in the route file) because Next.js's App Router route
 * type-checking only permits a fixed set of exports (HTTP method handlers,
 * `runtime`, `config`, etc.) from a `route.ts` file — anything else fails
 * the generated route-type validation at build time.
 */

export function pickStr(row: Record<string, string>, key: string): string {
  return String(row[key] ?? "").trim();
}

/**
 * `mapping` (as built by the Import Data UI's column-mapping step and sent
 * to the API) is keyed `{csvHeader: canonicalField}` — see
 * src/app/import/page.tsx's onChange handler (`next[header] = field.key`)
 * and its "mapped" summary lookup (`Object.entries(mapping).find(([, v]) =>
 * v === field.key)`), which both confirm this direction. Reading a row by
 * canonical field therefore requires the REVERSE lookup (field → header),
 * not `mapping[field]` directly — indexing by field only "worked" in tests
 * whose fixtures happened to use the canonical name as the row key already,
 * masking that real column remapping (a CSV header that doesn't literally
 * match the canonical field name) silently read nothing. Build this once per
 * import run, outside the per-row loop, since `mapping` doesn't change row
 * to row.
 */
export function buildFieldGetter(mapping: Record<string, string>): (row: Record<string, string>, field: string) => string {
  const reverseMapping: Record<string, string> = {};
  for (const [header, field] of Object.entries(mapping)) {
    reverseMapping[field] = header;
  }
  return (row, field) => pickStr(row, reverseMapping[field] ?? field);
}

export function parseDate(val: string): Date | null {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

export interface ImportRowResult {
  row: number;
  status: "ok" | "error";
  message?: string;
}

/**
 * Imports (or updates, if matched by email) OrgMember rows from parsed
 * spreadsheet/SQLite rows. Enforces the organization's plan member limit:
 * resolved once up front, then tracked in-memory as new rows are created —
 * avoids re-querying the plan/count on every row while still enforcing the
 * same limit requireMemberSlot() checks for a single-member create. Updates
 * to an existing member never consume a slot, so only new inserts advance
 * the counter; rows beyond the limit are reported as per-row errors rather
 * than failing the whole import.
 */
export async function importMembers(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  organizationId: string,
  preview: boolean
): Promise<ImportRowResult[]> {
  const results: ImportRowResult[] = [];

  const memberLimit = preview ? null : await checkMemberLimit(organizationId);
  let newMemberCount = memberLimit?.current ?? 0;
  const getField = buildFieldGetter(mapping);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const get = (field: string) => getField(row, field);

    const firstName = get("firstName");
    const lastName = get("lastName");

    if (!firstName && !lastName) {
      results.push({ row: i + 2, status: "error", message: "First name and last name are both blank" });
      continue;
    }

    if (preview) {
      results.push({ row: i + 2, status: "ok" });
      continue;
    }

    const { email, error: emailError } = parseImportEmail(get("email"));
    if (emailError) {
      results.push({ row: i + 2, status: "error", message: emailError });
      continue;
    }

    try {
      const existing = email
        ? await prisma.orgMember.findFirst({ where: { organizationId, email } })
        : null;

      if (existing) {
        await prisma.orgMember.update({
          where: { id: existing.id },
          data: {
            firstName: firstName || existing.firstName,
            lastName: lastName || existing.lastName,
            phone: get("phone") || existing.phone,
            addressLine1: get("address") || existing.addressLine1,
            city: get("city") || existing.city,
            state: get("state") || existing.state,
            zipCode: get("zip") || existing.zipCode,
            joinDate: parseDate(get("joinDate")) ?? existing.joinDate,
          },
        });
      } else {
        if (memberLimit && newMemberCount >= memberLimit.limit) {
          results.push({
            row: i + 2,
            status: "error",
            message: `Member limit reached (${memberLimit.limit}). Upgrade your plan to import more members.`,
          });
          continue;
        }
        await prisma.orgMember.create({
          data: {
            organizationId,
            firstName: firstName || "Unknown",
            lastName: lastName || "Unknown",
            email: email || null,
            phone: get("phone") || null,
            addressLine1: get("address") || null,
            city: get("city") || null,
            state: get("state") || null,
            zipCode: get("zip") || null,
            joinDate: parseDate(get("joinDate")),
          },
        });
        newMemberCount++;
      }
      results.push({ row: i + 2, status: "ok" });
    } catch (err) {
      results.push({ row: i + 2, status: "error", message: String(err) });
    }
  }

  return results;
}
