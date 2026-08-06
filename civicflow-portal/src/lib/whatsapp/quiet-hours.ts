/**
 * Returns the current hour-of-day (0-23) in the given IANA timezone,
 * dependency-free via Intl.DateTimeFormat — no other part of the app has a
 * timezone-aware hour helper to reuse (formatting.ts always uses the
 * browser/server default timezone).
 */
function hourInTimezone(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).formatToParts(date);
  const hourPart = parts.find((part) => part.type === "hour")?.value ?? "0";
  // Intl can format midnight as "24" with hour12: false in some environments — normalize.
  return Number(hourPart) % 24;
}

/**
 * True if `date` falls within the [startHour, endHour) quiet-hours window,
 * in the organization's local timezone. Handles the common overnight-wrapping
 * case (e.g. startHour=21, endHour=8 means "quiet from 9pm to 8am") as well
 * as a same-day window (startHour < endHour).
 */
export function isWithinQuietHours(date: Date, timezone: string, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false; // a zero-width window means quiet hours are effectively off
  const hour = hourInTimezone(date, timezone);
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}
