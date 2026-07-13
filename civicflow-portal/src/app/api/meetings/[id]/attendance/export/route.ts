import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

/** Neutralizes spreadsheet formula injection (a leading =, +, -, @, tab, or
 * CR makes Excel/Sheets treat the cell as a formula) by prefixing a literal
 * apostrophe, then applies standard CSV quoting on top. Scoped to this
 * export only — not a change to the shared exporters.ts used elsewhere. */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

/**
 * Same permission as the roster (attendance:read) — an export is just the
 * roster in a downloadable form, so it must not be reachable by anyone who
 * couldn't already view the roster on-screen.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("attendance:read", "throw");
    const { id } = await params;

    const meeting = await prisma.meeting.findFirst({ where: { id, organizationId } });
    if (!meeting) return Response.json({ ok: false, error: "Meeting not found" }, { status: 404 });

    const rows = await prisma.attendanceRecord.findMany({
      where: { organizationId, meetingId: id },
      include: { member: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: [{ member: { lastName: "asc" } }, { member: { firstName: "asc" } }],
    });

    const header = csvRow([
      "First Name",
      "Last Name",
      "Email",
      "Status",
      "Method",
      "Checked In At",
      "Checked Out At",
      "Correction Reason",
      "Notes",
    ]);
    const lines = [header, ...rows.map((row) =>
      csvRow([
        row.member.firstName,
        row.member.lastName,
        row.member.email ?? "",
        row.attendanceStatus,
        row.method,
        row.checkInTime ? row.checkInTime.toISOString() : "",
        row.checkOutTime ? row.checkOutTime.toISOString() : "",
        row.correctionReason ?? "",
        row.notes ?? "",
      ])
    )];

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "export",
      entityType: "meeting_attendance",
      entityId: id,
      metadata: { count: rows.length },
    });

    const fileName = `unestra-attendance-${meeting.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  });
}
