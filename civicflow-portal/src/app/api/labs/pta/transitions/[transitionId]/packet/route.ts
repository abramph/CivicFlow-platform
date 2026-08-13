import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { toWinAnsiSafe } from "@/lib/pdf-text";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { requirePtaVertical } from "@/lib/labs/pta/guard";
import { collectTransitionPacketData } from "@/lib/labs/pta/transition-packet";
import { requirePermission } from "@/lib/auth-guards";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const LINE_HEIGHT = 15;

/**
 * GET /api/labs/pta/transitions/:id/packet — the §14 Transition Packet PDF.
 * pta:board:manage gated and audited. Confidential grievance information is
 * never included (see transition-packet.ts) — at most an open-case count for
 * concern-permission holders.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ transitionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session, can } = await requirePermission("pta:board:manage", "throw");
    await requirePtaVertical(organizationId);
    const { transitionId } = await params;

    const packet = await collectTransitionPacketData(organizationId, transitionId, {
      canViewConcerns: can("pta:concerns:view"),
    });

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - MARGIN;

    function writeLine(rawText: string, options: { size?: number; useBold?: boolean; gray?: boolean } = {}) {
      const size = options.size ?? 10;
      const usedFont = options.useBold ? bold : font;
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

    writeLine(packet.title, { size: 18, useBold: true });
    writeLine(packet.subtitle, { gray: true });
    writeLine(`Generated ${new Date().toLocaleDateString("en-US", { dateStyle: "long" })}`, { gray: true });
    for (const section of packet.sections) {
      y -= 12;
      writeLine(section.title, { size: 13, useBold: true });
      y -= 2;
      for (const line of section.lines) {
        writeLine(line);
      }
    }

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "pta.transition.packet_downloaded",
      entityType: "pta_board_transition",
      entityId: transitionId,
      metadata: { sections: packet.sections.length },
    });

    const bytes = await pdf.save();
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="transition-packet.pdf"`,
      },
    });
  });
}
