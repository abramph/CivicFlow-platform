/**
 * fix/pta-volunteer-financial-controls, FC-6 — organization-local time
 * handling for the volunteer-hours feature. `OrgSettings.timezone`
 * (prisma/schema.prisma) is the existing, reliable canonical IANA
 * timezone field already used elsewhere in this codebase (e.g.
 * `src/lib/whatsapp/quiet-hours.ts`) and already snapshotted onto
 * `PtaVolunteerRequirementPeriod.timezone` / `PtaVolunteerPricingWindow.timezone`
 * at creation — no new schema field is needed. What was missing is the
 * conversion utility: every admin-entered date/time in this feature (period
 * dates, buyout window, assessment dates, pricing-window start/end) comes
 * from a zone-less `<input type="date">` or `<input type="datetime-local">`
 * value. Passing that string straight into `new Date(...)` (as
 * `z.coerce.date()` previously did) is either always-UTC (date-only
 * strings — silently wrong for every US timezone, since "starts Sept 1"
 * became "starts Sept 1 00:00 UTC" = the evening of Aug 31 local time for
 * any negative-offset zone) or implementation/server-timezone-dependent
 * (datetime-local strings — depends on the deploy container's `TZ`, never
 * the org's). This module is the single server-boundary conversion point
 * every such field must go through instead.
 */

function getUtcOffsetMinutes(utcGuessMs: number, timezone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcGuessMs));
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const asUtcMs = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
  return (asUtcMs - utcGuessMs) / 60_000;
}

const WALL_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;
/** Already an absolute instant (has a UTC/offset suffix) — e.g. what a
 * previous API response's `JSON.stringify(Date)` round-trips back as when a
 * UI re-submits a value it only meant to leave unchanged (see
 * `PtaVolunteerPricingWindowsManager.tsx`'s activate/deactivate action,
 * which resends the window's own already-stored `startAt`/`endAt`). Must be
 * parsed as the instant it already is, never re-interpreted as a NEW
 * org-local wall time — that would double-convert it by the zone's offset. */
const ABSOLUTE_INSTANT_SUFFIX = /(Z|[+-]\d{2}:\d{2})$/;

/**
 * Converts a wall-clock date/time value into the UTC instant it represents
 * IN `timezone`. Accepts either a zone-less wall-clock string ("YYYY-MM-DD"
 * or "YYYY-MM-DDTHH:mm[:ss]") — exactly what `<input type="date">` and
 * `<input type="datetime-local">` produce, and the only form a NEW admin
 * edit ever supplies — or an already-absolute ISO instant (has a trailing
 * `Z`/offset), which is parsed as-is and not reinterpreted through
 * `timezone` at all. A date-only wall-clock string is treated as midnight.
 *
 * DST: a wall-clock time that doesn't exist (spring-forward gap) or exists
 * twice (fall-back overlap) resolves to whatever `Intl.DateTimeFormat`
 * computes for the UTC-guess instant on the current JS engine —
 * deterministic per engine, not further disambiguated. This is a narrow,
 * documented edge case (a period/window boundary landing exactly on a DST
 * transition night); it is not solved further here.
 */
export function resolveOrgWallTimeToUtc(wallTime: string, timezone: string): Date {
  const trimmed = wallTime.trim();
  if (ABSOLUTE_INSTANT_SUFFIX.test(trimmed)) {
    return new Date(trimmed);
  }
  const match = WALL_TIME_PATTERN.exec(trimmed);
  if (!match) {
    throw new Error(`Unparseable wall-clock date/time: "${wallTime}"`);
  }
  const [, year, month, day, hour, minute, second] = match;
  const utcGuessMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour ?? "0"), Number(minute ?? "0"), Number(second ?? "0"));
  const offsetMinutes = getUtcOffsetMinutes(utcGuessMs, timezone);
  return new Date(utcGuessMs - offsetMinutes * 60_000);
}

/** Same conversion, preserving `null`/`undefined` — the common shape for
 * this feature's many optional date fields (volunteerDeadline,
 * buyoutWindowStart/End, assessmentDate, assessmentPaymentDueDate). */
export function resolveOrgWallTimeToUtcNullable(wallTime: string | null | undefined, timezone: string): Date | null {
  if (wallTime == null || wallTime === "") return null;
  return resolveOrgWallTimeToUtc(wallTime, timezone);
}

/**
 * RV-6: the inclusive-end-of-day counterpart to `resolveOrgWallTimeToUtc`,
 * for a field whose stored comparison is an EXCLUSIVE end boundary
 * (`buyoutWindowEnd`) but whose admin-facing control is a bare
 * `<input type="date">` — an admin who types "September 30" means "through
 * the end of September 30," not "starting at midnight September 30" (the
 * literal defect the review flagged: "an admin selecting September 30
 * should not lose that entire day"). A date-only wall-clock string
 * resolves to the START of the FOLLOWING org-local calendar day, so the
 * exclusive `now >= end` comparison downstream stays open for the entire
 * typed day and closes only at the start of the day after. The day is
 * shifted via pure Y/M/D calendar arithmetic (`Date.UTC` field overflow),
 * never by adding 24 hours to an already-zoned instant, so it stays correct
 * across a DST transition landing on or adjacent to the boundary — the
 * shifted Y-M-D string is then resolved through the same offset-aware path
 * as `resolveOrgWallTimeToUtc`.
 *
 * A wall-clock string that already carries a time component
 * ("YYYY-MM-DDTHH:mm[:ss]") is resolved exactly like
 * `resolveOrgWallTimeToUtc` with no shift — the admin supplied a precise
 * instant, so there is no "which day" ambiguity to resolve. An
 * already-absolute ISO instant (Z/offset suffix) is also passed through
 * unshifted, for the same round-trip reason `resolveOrgWallTimeToUtc`
 * documents.
 */
export function resolveOrgWallTimeEndOfDayToUtc(wallTime: string, timezone: string): Date {
  const trimmed = wallTime.trim();
  if (ABSOLUTE_INSTANT_SUFFIX.test(trimmed)) {
    return new Date(trimmed);
  }
  const match = WALL_TIME_PATTERN.exec(trimmed);
  if (!match) {
    throw new Error(`Unparseable wall-clock date/time: "${wallTime}"`);
  }
  const [, year, month, day, hour] = match;
  if (hour != null) {
    return resolveOrgWallTimeToUtc(wallTime, timezone);
  }
  const nextDay = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + 1));
  const nextDayWallDate = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDay.getUTCDate()).padStart(2, "0")}`;
  return resolveOrgWallTimeToUtc(nextDayWallDate, timezone);
}

/** Same conversion, preserving `null`/`undefined` — mirrors
 * `resolveOrgWallTimeToUtcNullable` for the end-of-day variant. */
export function resolveOrgWallTimeEndOfDayToUtcNullable(wallTime: string | null | undefined, timezone: string): Date | null {
  if (wallTime == null || wallTime === "") return null;
  return resolveOrgWallTimeEndOfDayToUtc(wallTime, timezone);
}

/**
 * The inverse of `resolveOrgWallTimeToUtc` — formats a stored UTC instant
 * as the wall-clock string an admin in `timezone` would recognize as what
 * they typed, in exactly the format `<input type="date">` /
 * `<input type="datetime-local">` expect back ("YYYY-MM-DD" or
 * "YYYY-MM-DDTHH:mm"). Dependency-free via `Intl.DateTimeFormat`, safe to
 * import from a client component (no server-only imports) — this is what
 * every list/detail view and edit-form pre-fill in this feature must use
 * instead of slicing the raw UTC ISO string, which shows the org's actual
 * local calendar date/time only by coincidence for negative-UTC-offset
 * zones (all of the US) and is wrong for positive-offset zones.
 */
export function formatOrgWallTime(instant: Date | string, timezone: string, includeTime: boolean): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: includeTime ? "2-digit" : undefined,
    minute: includeTime ? "2-digit" : undefined,
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const datePart = `${map.year}-${map.month}-${map.day}`;
  return includeTime ? `${datePart}T${map.hour}:${map.minute}` : datePart;
}

/**
 * RV-6: the display-direction inverse of `resolveOrgWallTimeEndOfDayToUtc`
 * — shows the admin-meaningful LAST INCLUDED day for a stored
 * exclusive-end-of-day boundary, not the following day it's actually
 * stored as. Round-trips exactly with `resolveOrgWallTimeEndOfDayToUtc` for
 * any date-only input: edit → display → re-save reproduces the identical
 * stored instant. Subtracts one calendar day via the same DST-safe Y/M/D
 * arithmetic the forward conversion uses.
 */
export function formatOrgWallTimeEndOfDayInclusive(instant: Date | string, timezone: string): string {
  const dateOnly = formatOrgWallTime(instant, timezone, false);
  const [year, month, day] = dateOnly.split("-").map(Number);
  const prevDay = new Date(Date.UTC(year, month - 1, day - 1));
  return `${prevDay.getUTCFullYear()}-${String(prevDay.getUTCMonth() + 1).padStart(2, "0")}-${String(prevDay.getUTCDate()).padStart(2, "0")}`;
}
