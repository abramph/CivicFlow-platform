import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { MinutesExportInput } from "./types";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const LINE_HEIGHT = 16;

function wrapText(text: string, font: import("pdf-lib").PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function exportMinutesToPdf(input: MinutesExportInput): Promise<Buffer> {
  const { content } = input;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function ensureSpace(neededLines = 1) {
    if (y - neededLines * LINE_HEIGHT < MARGIN) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }

  function writeLine(text: string, options: { size?: number; useBold?: boolean; color?: [number, number, number] } = {}) {
    const size = options.size ?? 10;
    const f = options.useBold ? bold : font;
    const [r, g, b] = options.color ?? [0.08, 0.11, 0.18];
    ensureSpace();
    for (const line of wrapText(text, f, size, PAGE_WIDTH - MARGIN * 2)) {
      ensureSpace();
      page.drawText(line, { x: MARGIN, y, size, font: f, color: rgb(r, g, b) });
      y -= LINE_HEIGHT;
    }
  }

  function writeHeading(text: string) {
    y -= 6;
    writeLine(text, { size: 13, useBold: true });
    y -= 2;
  }

  writeLine(input.organizationName, { size: 10, color: [0.28, 0.33, 0.41] });
  writeLine(input.meetingTitle, { size: 18, useBold: true });
  writeLine(input.meetingDate ? new Date(input.meetingDate).toLocaleString() : "Date not recorded", { size: 10, color: [0.28, 0.33, 0.41] });

  if (!input.isApproved) {
    y -= 8;
    writeLine("DRAFT — NOT OFFICIAL", { size: 14, useBold: true, color: [0.71, 0.32, 0.04] });
    writeLine(content.aiDisclaimer, { size: 9, color: [0.55, 0.36, 0.02] });
  } else {
    y -= 8;
    writeLine(
      `Approved${input.approvedByName ? ` by ${input.approvedByName}` : ""}${input.approvedAt ? ` on ${new Date(input.approvedAt).toLocaleString()}` : ""}.`,
      { size: 9, color: [0.28, 0.33, 0.41] }
    );
  }

  writeHeading("Attendance");
  if (content.attendance.length === 0) writeLine("(none recorded)");
  for (const a of content.attendance) writeLine(`• ${a.attendeeName ?? a.speakerLabel}`);

  writeHeading("Agenda");
  if (content.agendaItems.length === 0) writeLine("(none recorded)");
  for (const item of content.agendaItems) writeLine(`• ${item}`);

  writeHeading("Discussion Summary");
  if (content.discussionSummaries.length === 0) writeLine("(none recorded)");
  for (const s of content.discussionSummaries) writeLine(`${s.topic}: ${s.summary}`);

  writeHeading("Motions & Votes");
  if (content.motions.length === 0) writeLine("(none recorded)");
  for (const m of content.motions) writeLine(`• ${m.text} — ${m.voteResult}`);

  writeHeading("Decisions");
  if (content.decisions.length === 0) writeLine("(none recorded)");
  for (const d of content.decisions) writeLine(`• ${d}`);

  writeHeading("Action Items");
  if (content.actionItems.length === 0) writeLine("(none recorded)");
  for (const a of content.actionItems) writeLine(`• ${a.description}${a.owner ? ` — Owner: ${a.owner}` : ""}${a.dueDate ? ` (Due: ${a.dueDate})` : ""}`);

  writeHeading("Next Meeting");
  writeLine(content.nextMeetingDetails ?? "(not recorded)");

  return Buffer.from(await pdf.save());
}
