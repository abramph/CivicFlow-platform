import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { toWinAnsiSafe } from "@/lib/pdf-text";
import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const LINE_HEIGHT = 15;

/**
 * PTA Vertical 2.0, PR PTA-D (deferred from PTA-C) — PDF export of an
 * approved minutes version. Only APPROVED or SUPERSEDED (i.e. once-approved)
 * versions export: a draft is not a governance record yet. The PDF is
 * generated from the immutable stored text; nothing is mutated.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; minutesId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("meetings:read", "throw");
    const { id, minutesId } = await params;

    const minutes = await prisma.meetingMinutes.findFirst({
      where: { id: minutesId, meetingId: id, organizationId, status: { in: ["APPROVED", "SUPERSEDED"] } },
      include: {
        meeting: { select: { title: true, meetingDate: true, location: true } },
        approvedByUser: { select: { displayName: true, email: true } },
        organization: { select: { name: true } },
      },
    });
    if (!minutes) return Response.json({ ok: false, error: "No approved minutes version found." }, { status: 404 });

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - MARGIN;

    function writeLine(rawText: string, options: { size?: number; useBold?: boolean; gray?: boolean } = {}) {
      const size = options.size ?? 10;
      const usedFont = options.useBold ? bold : font;
      // User text (titles, minutes body) can contain characters WinAnsi
      // cannot encode, which makes drawText throw — sanitize first.
      const words = toWinAnsiSafe(rawText).split(/\s+/);
      const maxWidth = PAGE_WIDTH - MARGIN * 2;
      let current = "";
      const lines: string[] = [];
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (usedFont.widthOfTextAtSize(candidate, size) > maxWidth && current) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      if (current) lines.push(current);
      for (const line of lines.length > 0 ? lines : [""]) {
        if (y < MARGIN + LINE_HEIGHT) {
          page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
          y = PAGE_HEIGHT - MARGIN;
        }
        page.drawText(line, { x: MARGIN, y, size, font: usedFont, color: options.gray ? rgb(0.35, 0.4, 0.47) : rgb(0.08, 0.11, 0.18) });
        y -= LINE_HEIGHT;
      }
    }

    writeLine(minutes.organization.name, { gray: true });
    y -= 4;
    writeLine(minutes.title, { size: 16, useBold: true });
    writeLine(
      `${minutes.meeting.title} — ${minutes.meeting.meetingDate.toLocaleDateString("en-US", { dateStyle: "long" })}${minutes.meeting.location ? ` — ${minutes.meeting.location}` : ""}`,
      { gray: true }
    );
    writeLine(
      `Version ${minutes.version} · Approved${minutes.approvedAt ? ` ${minutes.approvedAt.toLocaleDateString("en-US", { dateStyle: "long" })}` : ""}${minutes.approvedByUser ? ` by ${minutes.approvedByUser.displayName ?? minutes.approvedByUser.email}` : ""}${minutes.status === "SUPERSEDED" ? " · Superseded by a later version" : ""}`,
      { gray: true }
    );
    y -= 10;
    for (const paragraph of minutes.bodyText.split(/\r?\n/)) {
      writeLine(paragraph);
    }

    const bytes = await pdf.save();
    const safeTitle = minutes.meeting.title.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-").toLowerCase() || "meeting";
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="minutes-${safeTitle}-v${minutes.version}.pdf"`,
      },
    });
  });
}
