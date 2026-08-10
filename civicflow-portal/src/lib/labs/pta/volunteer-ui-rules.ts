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

/** Mirrors updatePtaVolunteerSlot()'s guard (volunteers.ts): rejects a
 * capacity below the number of volunteers already assigned, and rejects
 * anything not a positive integer. The edit form's number input previously
 * only carried a decorative HTML `min` attribute — unenforced, since the
 * form has no native submit to trigger browser validation — so a typed
 * value below claimedCount reached Save fully clickable. */
export function canSaveSlotCapacity(capacity: number, claimedCount: number): boolean {
  return Number.isInteger(capacity) && capacity >= 1 && capacity >= claimedCount;
}

/** Mirrors claimPtaVolunteerSlot()'s guards (volunteers.ts) not already
 * covered by the page-level OPEN-opportunity filter: a shift can be
 * individually closed/cancelled even while its parent opportunity stays
 * OPEN, and a signup deadline is a known-in-advance fact, not a race — both
 * are guaranteed rejections if left clickable, the same class of bug as
 * the Delete Shift case. */
export function canClaimSlot(params: { slotStatus: string; full: boolean; signupDeadlinePassed: boolean }): boolean {
  return params.slotStatus === "OPEN" && !params.full && !params.signupDeadlinePassed;
}

/** Mirrors cancelPtaVolunteerSignup()'s cancellation-deadline guard
 * (volunteers.ts) for the member self-service path, which never passes
 * officerOverride. Deliberately independent of slot/opportunity open/closed
 * state — cancelling out of a commitment must remain possible even if the
 * shift itself was later closed, matching the server, which never checks
 * slot/opportunity status here at all. */
export function canCancelSignup(cancellationDeadlinePassed: boolean): boolean {
  return !cancellationDeadlinePassed;
}
