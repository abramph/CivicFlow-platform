import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { MinutesExportInput } from "./types";

function bulletParagraphs(items: string[]): Paragraph[] {
  if (items.length === 0) return [new Paragraph({ children: [new TextRun({ text: "(none recorded)", italics: true })] })];
  return items.map((item) => new Paragraph({ text: item, bullet: { level: 0 } }));
}

export async function exportMinutesToDocx(input: MinutesExportInput): Promise<Buffer> {
  const { content } = input;

  const watermarkParagraphs = input.isApproved
    ? []
    : [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "DRAFT — NOT OFFICIAL", bold: true, color: "B45309", size: 32 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: content.aiDisclaimer, italics: true, size: 20 })],
        }),
        new Paragraph({ text: "" }),
      ];

  const approvalParagraphs = input.isApproved
    ? [
        new Paragraph({
          children: [
            new TextRun({
              text: `Approved${input.approvedByName ? ` by ${input.approvedByName}` : ""}${input.approvedAt ? ` on ${new Date(input.approvedAt).toLocaleString()}` : ""}.`,
              italics: true,
            }),
          ],
        }),
        new Paragraph({ text: "" }),
      ]
    : [];

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: input.organizationName, heading: HeadingLevel.HEADING_3 }),
          new Paragraph({ text: input.meetingTitle, heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: input.meetingDate ? new Date(input.meetingDate).toLocaleString() : "Date not recorded" }),
          new Paragraph({ text: "" }),
          ...watermarkParagraphs,
          ...approvalParagraphs,

          new Paragraph({ text: "Attendance", heading: HeadingLevel.HEADING_2 }),
          ...bulletParagraphs(content.attendance.map((a) => a.attendeeName ?? a.speakerLabel)),

          new Paragraph({ text: "Agenda", heading: HeadingLevel.HEADING_2 }),
          ...bulletParagraphs(content.agendaItems),

          new Paragraph({ text: "Discussion Summary", heading: HeadingLevel.HEADING_2 }),
          ...(content.discussionSummaries.length
            ? content.discussionSummaries.map((s) => new Paragraph({ children: [new TextRun({ text: `${s.topic}: `, bold: true }), new TextRun(s.summary)] }))
            : [new Paragraph({ children: [new TextRun({ text: "(none recorded)", italics: true })] })]),

          new Paragraph({ text: "Motions & Votes", heading: HeadingLevel.HEADING_2 }),
          ...(content.motions.length
            ? content.motions.map(
                (m) =>
                  new Paragraph({
                    children: [
                      new TextRun(`${m.text} — `),
                      new TextRun({ text: m.voteResult, bold: true }),
                      ...(m.proposedBy ? [new TextRun(` (proposed by ${m.proposedBy}${m.secondedBy ? `, seconded by ${m.secondedBy}` : ""})`)] : []),
                    ],
                  })
              )
            : [new Paragraph({ children: [new TextRun({ text: "(none recorded)", italics: true })] })]),

          new Paragraph({ text: "Decisions", heading: HeadingLevel.HEADING_2 }),
          ...bulletParagraphs(content.decisions),

          new Paragraph({ text: "Action Items", heading: HeadingLevel.HEADING_2 }),
          ...(content.actionItems.length
            ? content.actionItems.map(
                (a) =>
                  new Paragraph({
                    text: `${a.description}${a.owner ? ` — Owner: ${a.owner}` : ""}${a.dueDate ? ` (Due: ${a.dueDate})` : ""}`,
                    bullet: { level: 0 },
                  })
              )
            : [new Paragraph({ children: [new TextRun({ text: "(none recorded)", italics: true })] })]),

          new Paragraph({ text: "Next Meeting", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: content.nextMeetingDetails ?? "(not recorded)" }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
