import * as XLSX from "xlsx";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { maskPhone } from "@/lib/sms-otp";
import { csvCell, sanitizeFormulaCell } from "@/lib/csv-safety";

const EXPORT_LIMIT = 5000;
const FORMATS = new Set(["csv", "xlsx"]);

function exportDateStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

/** GET: filterable SMS log export (org, status, date range), mirroring the members/export route's shape. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");
    const url = new URL(request.url);
    const format = (url.searchParams.get("format") || "csv").toLowerCase();
    if (!FORMATS.has(format)) {
      return Response.json({ ok: false, error: "Unsupported export format." }, { status: 400 });
    }

    const organizationId = url.searchParams.get("organizationId") || undefined;
    const status = url.searchParams.get("status") || undefined;
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");

    const where = {
      ...(organizationId ? { organizationId } : {}),
      ...(status ? { status: status as never } : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
    };

    const count = await prisma.smsMessage.count({ where });
    if (count > EXPORT_LIMIT) {
      return Response.json(
        { ok: false, error: `Export contains ${count} messages. Narrow the filters to ${EXPORT_LIMIT} rows or fewer.` },
        { status: 400 }
      );
    }

    const messages = await prisma.smsMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: EXPORT_LIMIT,
      include: {
        organization: { select: { name: true } },
        member: { select: { firstName: true, lastName: true } },
      },
    });

    const rows = messages.map((message) => ({
      Date: message.createdAt.toISOString(),
      Organization: sanitizeFormulaCell(message.organization.name),
      Member: sanitizeFormulaCell(message.member ? `${message.member.firstName} ${message.member.lastName}` : ""),
      Phone: maskPhone(message.phone),
      "Message Type": message.campaignId ? "Campaign" : "Direct",
      Status: message.status,
      "Provider SID": message.providerMessageId ?? "",
      "Delivery Time": message.sentAt ? message.sentAt.toISOString() : "",
      Cost: message.actualCostCents != null ? `$${(message.actualCostCents / 100).toFixed(4)}` : "",
    }));

    await createAuditEvent({
      organizationId: null,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "sms_admin.logs_exported",
      entityType: "SmsMessage",
      metadata: { format, count: rows.length, organizationId: organizationId ?? null, status: status ?? null },
    });

    const filenameBase = `unestra-sms-logs-${exportDateStamp()}`;

    if (format === "xlsx") {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(workbook, worksheet, "SMS Logs");
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filenameBase}.xlsx"`,
        },
      });
    }

    const headers = Object.keys(
      rows[0] ?? {
        Date: "",
        Organization: "",
        Member: "",
        Phone: "",
        "Message Type": "",
        Status: "",
        "Provider SID": "",
        "Delivery Time": "",
        Cost: "",
      }
    );
    const csv = [headers.join(","), ...rows.map((row) => headers.map((h) => csvCell((row as Record<string, unknown>)[h])).join(","))].join(
      "\r\n"
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
      },
    });
  });
}
