import type { StructuredMeetingMinutes } from "../minutes";

/**
 * Meeting Intelligence MVP — export input. Deliberately carries only the
 * structured minutes content — never the transcript or raw recording, so
 * "do not include raw transcript content by default" is true by
 * construction rather than by a filter step that could be forgotten.
 */
export interface MinutesExportInput {
  organizationName: string;
  meetingTitle: string;
  meetingDate: string | null;
  isApproved: boolean;
  approvedByName?: string | null;
  approvedAt?: string | null;
  content: StructuredMeetingMinutes;
}

export type MinutesExportFormat = "docx" | "pdf";
