/**
 * Event.status was a free-text field with no dropdown and no server-side
 * enum validation — a staff member typing "Canceled" or "CANCELLED" instead
 * of "cancelled" silently failed to match the events-list "Upcoming /
 * Active" filter's exact-string check, leaving a cancelled event still
 * counted as active. Constraining new writes to this fixed set (via the
 * form dropdown + updateEventSchema/createEventSchema below) closes that off
 * going forward; normalizeEventStatus below also protects reads against any
 * inconsistent values already written before this field was constrained.
 */
export const EVENT_STATUSES = ["upcoming", "in_progress", "completed", "cancelled"] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  upcoming: "Upcoming",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const LEGACY_STATUS_ALIASES: Record<string, EventStatus> = {
  cancelled: "cancelled",
  canceled: "cancelled",
  cancel: "cancelled",
  completed: "completed",
  complete: "completed",
  done: "completed",
  finished: "completed",
  "in_progress": "in_progress",
  "in progress": "in_progress",
  ongoing: "in_progress",
  active: "in_progress",
  upcoming: "upcoming",
  scheduled: "upcoming",
  planned: "upcoming",
};

/** Maps any legacy/free-text status value (written before this field was constrained) to one of the fixed EVENT_STATUSES, defaulting to "upcoming" for anything unrecognized. */
export function normalizeEventStatus(raw: string): EventStatus {
  return LEGACY_STATUS_ALIASES[raw.trim().toLowerCase()] ?? "upcoming";
}

export function isCancelledEventStatus(raw: string): boolean {
  return normalizeEventStatus(raw) === "cancelled";
}

export function isActiveEventStatus(raw: string): boolean {
  const status = normalizeEventStatus(raw);
  return status !== "completed" && status !== "cancelled";
}
