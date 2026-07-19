import { exportMinutesToDocx } from "./docx-exporter";
import { exportMinutesToPdf } from "./pdf-exporter";
import type { MinutesExportFormat, MinutesExportInput } from "./types";

export type { MinutesExportFormat, MinutesExportInput } from "./types";

export async function exportMeetingMinutes(input: MinutesExportInput, format: MinutesExportFormat): Promise<Buffer> {
  return format === "docx" ? exportMinutesToDocx(input) : exportMinutesToPdf(input);
}

export function minutesExportContentType(format: MinutesExportFormat): string {
  return format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf";
}

export function minutesExportFileName(meetingTitle: string, format: MinutesExportFormat): string {
  const slug = meetingTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "meeting-minutes";
  const date = new Date().toISOString().slice(0, 10);
  return `${slug}-minutes-${date}.${format}`;
}
