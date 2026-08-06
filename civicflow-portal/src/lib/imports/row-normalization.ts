import { createHash } from "crypto";
import { buildFieldGetter, parseDate } from "@/lib/member-import";
import { parseImportEmail } from "@/lib/email";

/**
 * Resumable Import Program (PR A) — row normalization for Community member
 * imports. Reuses src/lib/member-import.ts's pickStr/buildFieldGetter/
 * parseDate directly rather than re-implementing them — same column-mapping
 * direction, same date-parsing behavior as the existing /api/import path.
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
