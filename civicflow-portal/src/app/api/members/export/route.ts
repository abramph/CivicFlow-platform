import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import ExcelJS from "exceljs";
import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { requirePlanFeature } from "@/lib/plan-gate";
import { createAuditEvent } from "@/lib/audit";
import {
  buildMemberOrderBy,
  buildMemberWhere,
  calculateAge,
  calculateMemberOutstandingDues,
  describeMemberFilters,
  memberExportInclude,
  parseMemberFilters,
  type MemberExportRow,
} from "@/lib/member-filters";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/formatting";
import { csvCell, sanitizeFormulaCell } from "@/lib/csv-safety";

const EXPORT_LIMIT = 5000;
const formats = new Set(["csv", "xlsx", "pdf", "print"]);

function isoDate(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function exportDateStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function memberName(member: MemberExportRow) {
  return [member.preferredName || member.firstName, member.lastName].filter(Boolean).join(" ");
}

/**
 * Every user-editable free-text field (name, address, gender, etc.) is run
 * through sanitizeFormulaCell() here — before either the CSV or XLSX path
 * consumes these rows — since XLSX.utils.json_to_sheet() writes values
 * as-is and Excel treats a leading =/+/-/@ as a formula regardless of
 * whether the file arrived as .csv or .xlsx.
 */
function buildRows(members: MemberExportRow[]) {
  return members.map((member) => ({
    "Member ID": member.id,
    "First Name": sanitizeFormulaCell(member.firstName),
    "Last Name": sanitizeFormulaCell(member.lastName),
    "Preferred Name": sanitizeFormulaCell(member.preferredName ?? ""),
    Status: member.membershipStatus,
    Category: sanitizeFormulaCell(member.membershipCategory?.name ?? ""),
    DOB: isoDate(member.dateOfBirth),
    Age: calculateAge(member.dateOfBirth),
    Gender: sanitizeFormulaCell(member.gender ?? ""),
    Email: sanitizeFormulaCell(member.email ?? ""),
    Phone: sanitizeFormulaCell(member.phone ?? ""),
    "Address Line 1": sanitizeFormulaCell(member.addressLine1 ?? ""),
    "Address Line 2": sanitizeFormulaCell(member.addressLine2 ?? ""),
    City: sanitizeFormulaCell(member.city ?? ""),
    State: sanitizeFormulaCell(member.state ?? ""),
    ZIP: sanitizeFormulaCell(member.zipCode ?? ""),
    County: sanitizeFormulaCell(member.county ?? ""),
    Country: sanitizeFormulaCell(member.country ?? ""),
    "Join Date": isoDate(member.joinDate),
    Delinquent: member.isDelinquent ? "Yes" : "No",
    "Outstanding Dues": formatCurrency(calculateMemberOutstandingDues(member)),
    "Created At": member.createdAt.toISOString(),
  }));
}

function buildCsv(rows: Array<Record<string, unknown>>) {
  const headers = Object.keys(rows[0] ?? {
    "Member ID": "",
    "First Name": "",
    "Last Name": "",
    "Preferred Name": "",
    Status: "",
    Category: "",
    DOB: "",
    Age: "",
    Gender: "",
    Email: "",
    Phone: "",
    "Address Line 1": "",
    "Address Line 2": "",
    City: "",
    State: "",
    ZIP: "",
    County: "",
    Country: "",
    "Join Date": "",
    Delinquent: "",
    "Outstanding Dues": "",
    "Created At": "",
  });
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\r\n");
}

async function buildXlsx(rows: Array<Record<string, unknown>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Members");
  const headers = Object.keys(rows[0] ?? {});
  worksheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: Math.min(40, Math.max(header.length + 2, ...rows.map((row) => String(row[header] ?? "").length + 2))),
  }));
  worksheet.addRows(rows);
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildPdf(input: {
  organizationName: string;
  filtersSummary: string;
  members: MemberExportRow[];
}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 792;
  const pageHeight = 612;
  const margin = 36;
  const lineColor = rgb(0.78, 0.82, 0.88);
  const textColor = rgb(0.08, 0.11, 0.18);
  const mutedColor = rgb(0.32, 0.38, 0.48);

  const columns = [
    { label: "Name", x: 36, width: 115 },
    { label: "Status", x: 151, width: 60 },
    { label: "Category", x: 211, width: 85 },
    { label: "Age", x: 296, width: 30 },
    { label: "Email", x: 326, width: 125 },
    { label: "Phone", x: 451, width: 80 },
    { label: "City", x: 531, width: 75 },
    { label: "State", x: 606, width: 42 },
    { label: "ZIP", x: 648, width: 48 },
    { label: "Join", x: 696, width: 58 },
    { label: "Delinq.", x: 754, width: 42 },
  ];

  function truncate(text: string, maxWidth: number, size: number) {
    let next = text;
    while (font.widthOfTextAtSize(next, size) > maxWidth && next.length > 1) {
      next = next.slice(0, -1);
    }
    return next.length < text.length ? `${next.slice(0, Math.max(0, next.length - 1))}…` : next;
  }

  function addPage() {
    const page = pdf.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;
    page.drawText(input.organizationName, { x: margin, y, size: 16, font: boldFont, color: textColor });
    y -= 18;
    page.drawText("Filtered Member List", { x: margin, y, size: 12, font: boldFont, color: textColor });
    y -= 14;
    page.drawText(`Generated: ${new Date().toLocaleString("en-US")}`, { x: margin, y, size: 8, font, color: mutedColor });
    y -= 12;
    page.drawText(`Filters: ${truncate(input.filtersSummary, 720, 8)}`, { x: margin, y, size: 8, font, color: mutedColor });
    y -= 18;

    for (const column of columns) {
      page.drawText(column.label, { x: column.x, y, size: 7, font: boldFont, color: textColor });
    }
    page.drawLine({ start: { x: margin, y: y - 4 }, end: { x: pageWidth - margin, y: y - 4 }, thickness: 1, color: lineColor });
    return { page, y: y - 18 };
  }

  let current = addPage();
  for (const member of input.members) {
    if (current.y < margin + 18) {
      current = addPage();
    }
    const values = [
      memberName(member),
      member.membershipStatus,
      member.membershipCategory?.name ?? "",
      String(calculateAge(member.dateOfBirth)),
      member.email ?? "",
      member.phone ?? "",
      member.city ?? "",
      member.state ?? "",
      member.zipCode ?? "",
      isoDate(member.joinDate),
      member.isDelinquent ? "Yes" : "No",
    ];
    columns.forEach((column, index) => {
      current.page.drawText(truncate(values[index], column.width - 2, 7), {
        x: column.x,
        y: current.y,
        size: 7,
        font,
        color: textColor,
      });
    });
    current.y -= 16;
  }

  return pdf.save();
}

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("reports:export", "throw");
    const url = new URL(request.url);
    const format = (url.searchParams.get("format") || "csv").toLowerCase();
    if (!formats.has(format)) {
      return Response.json({ ok: false, error: "Unsupported export format." }, { status: 400 });
    }
    if (format === "pdf") {
      await requirePlanFeature(organizationId, "pdfExport");
    }

    const filters = parseMemberFilters(url.searchParams);
    const where = buildMemberWhere(organizationId, filters);
    const count = await prisma.orgMember.count({ where });
    if (count > EXPORT_LIMIT) {
      return Response.json(
        { ok: false, error: `Export contains ${count} members. Narrow the filters to ${EXPORT_LIMIT} rows or fewer.` },
        { status: 400 }
      );
    }

    const [organization, members] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
      prisma.orgMember.findMany({
        where,
        orderBy: buildMemberOrderBy(filters.sort),
        include: memberExportInclude,
        take: EXPORT_LIMIT,
      }),
    ]);

    const filtersSummary = describeMemberFilters(filters);
    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "export",
      entityType: "members_export",
      metadata: { format, count: members.length, filters: filtersSummary },
    });

    const filenameBase = `unestra-members-filtered-${exportDateStamp()}`;
    if (format === "print") {
      return Response.redirect(new URL(`/members/print?${url.searchParams.toString()}`, url.origin));
    }
    if (format === "xlsx") {
      const buffer = await buildXlsx(buildRows(members));
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filenameBase}.xlsx"`,
        },
      });
    }
    if (format === "pdf") {
      try {
        const buffer = await buildPdf({
          organizationName: organization?.name ?? "Unestra Organization",
          filtersSummary,
          members,
        });
        const body = new ArrayBuffer(buffer.byteLength);
        new Uint8Array(body).set(buffer);
        return new Response(body, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${filenameBase}.pdf"`,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "PDF export failed";
        return Response.json(
          {
            ok: false,
            error: process.env.NODE_ENV === "production" ? "PDF export failed." : message,
          },
          { status: 500 }
        );
      }
    }

    const csv = buildCsv(buildRows(members));
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
      },
    });
  });
}
