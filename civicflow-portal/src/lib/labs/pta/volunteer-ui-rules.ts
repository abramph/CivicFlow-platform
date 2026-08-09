/**
 * Pure visibility rules for the volunteer-management officer UI, kept
 * separate from the page component so they're directly unit-testable and so
 * each one can be pointed at the exact server-side guard it must never
 * drift from — a button offering an action the server is guaranteed to
 * reject (or silently no-op) is a real UX defect, not a cosmetic one.
 */

/** Mirrors deletePtaVolunteerSlot()'s guard (volunteers.ts): refuses whenever
 * ANY signup exists for the slot, regardless of status — a cancelled signup
 * still counts as history. `claimedCount` only reflects currently-active
 * claims, not history, so it is NOT the right input here. */
export function canDeleteShift(signupCount: number): boolean {
  return signupCount === 0;
}

/** The alternative action deletePtaVolunteerSlot()'s own error message
 * points to ("cancel it instead of deleting it") — only meaningful once a
 * shift has signup history (otherwise Delete already covers it) and isn't
 * already cancelled. */
export function canCancelShift(signupCount: number, shiftStatus: string): boolean {
  return signupCount > 0 && shiftStatus !== "CANCELLED";
}

/** Mirrors cancelPtaVolunteerSignup()'s guard (volunteers.ts): it silently
 * no-ops (200 OK, no audit event, no state change) for any status other
 * than exactly SIGNED_UP — once attendance has been recorded
 * (ATTENDED/PARTIAL/NO_SHOW/EXCUSED), "Remove" would look like it worked
 * but do nothing. */
export function canRemoveSignup(signupStatus: string): boolean {
  return signupStatus === "SIGNED_UP";
}
