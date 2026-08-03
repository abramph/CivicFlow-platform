import { z } from "zod";

// Same shape as the Zod validation already used by the single-record member
// create/update routes (src/app/api/members/route.ts, .../[id]/route.ts) --
// centralized here so every importer applies the identical rule instead of
// each quietly deciding its own.
const emailSchema = z.string().trim().email();

/** True only for a syntactically well-formed email address. Empty/whitespace-only input is not "valid" -- callers that treat a blank field as "no email" should check for that themselves before calling this. */
export function isValidEmail(value: string): boolean {
  return emailSchema.safeParse(value).success;
}

/**
 * Normalizes a raw import-row value into either a validated, trimmed +
 * lowercased email, or an explicit rejection reason -- never a silently
 * "fixed" address. Case-lowercasing isn't a content change (email local
 * parts are conventionally treated case-insensitively throughout this app,
 * e.g. the existing migration importer's `.toLowerCase()`), so it's applied
 * here too for consistent member-matching, but nothing else about the
 * address is altered.
 */
export function parseImportEmail(raw: string | null | undefined): { email: string | null; error: string | null } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { email: null, error: null };
  if (!isValidEmail(trimmed)) return { email: null, error: `Invalid email address: "${trimmed}"` };
  return { email: trimmed.toLowerCase(), error: null };
}
