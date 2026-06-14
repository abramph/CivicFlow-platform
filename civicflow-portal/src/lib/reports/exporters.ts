import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";
import type { ReportData, ReportRow, ReportType } from "@/lib/reports/report-builder";
import { formatDate } from "@/lib/formatting";

export type ReportExportFormat = "csv" | "xlsx" | "pdf";

function cell(value: unknown) {
  return String(value ?? "");
}

function csvEscape(value: unknown) {
  const text = cell(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function fileDate() {
  return new Date().toISOString().slice(0, 10);
}

export function reportFileName(reportType: ReportType, format: ReportExportFormat) {
  return `civicflow-${reportType.toLowerCase().replace(/_/g, "-")}-${fileDate()}.${format}`;
}

export function reportContentType(format: ReportExportFormat) {
  if (format === "csv") return "text/csv; charset=utf-8";
  if (format === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/pdf";
}

export function exportReportCsv(report: ReportData) {
  const lines: string[] = [];
  lines.push(csvEscape(report.title));
  lines.push(`Generated,${csvEscape(formatDate(report.metadata.generatedAt))}`);
  if (report.metadata.startDate || report.metadata.endDate) {
    lines.push(`Date range,${csvEscape(formatDate(report.metadata.startDate))} - ${csvEscape(formatDate(report.metadata.endDate))}`);
  }
  for (const item of report.summary) lines.push(`${csvEscape(item.label)},${csvEscape(item.value)}`);
  lines.push("");
  lines.push(report.columns.map(csvEscape).join(","));
  for (const row of report.rows) {
    lines.push(report.columns.map((column) => csvEscape(row[column])).join(","));
  }
  return Buffer.from(lines.join("\r\n"), "utf8");
}

export function exportReportXlsx(report: ReportData) {
  const workbook = XLSX.utils.book_new();
  const summaryRows = [
    [report.title],
    ["Generated", formatDate(report.metadata.generatedAt)],
    ["Date range", `${formatDate(report.metadata.startDate)} - ${formatDate(report.metadata.endDate)}`],
    [],
    ...report.summary.map((item) => [item.label, item.value]),
    [],
    report.columns,
    ...report.rows.map((row) => report.columns.map((column) => cell(row[column]))),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(summaryRows);
  worksheet["!cols"] = report.columns.map((column) => ({ wch: Math.max(14, column.length + 4) }));
  worksheet["!freeze"] = { xSplit: 0, ySplit: 7 };
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

function stringifyRow(row: ReportRow, columns: string[]) {
  return columns.map((column) => cell(row[column]));
}

export async function exportReportPdf(report: ReportData, organizationName: string) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 792;
  const pageHeight = 612;
  const margin = 32;
  const headerHeight = 112;
  const footerHeight = 26;
  const rowHeight = 18;
  const tableTop = pageHeight - headerHeight;
  const tableBottom = footerHeight + margin;
  const maxRowsPerPage = Math.max(1, Math.floor((tableTop - tableBottom - rowHeight) / rowHeight));
  const columns = report.columns.slice(0, 10);
  const colWidth = (pageWidth - margin * 2) / columns.length;

  const rows = report.rows.length ? report.rows : [{ Message: "No rows matched this report." }];
  const pages = Math.max(1, Math.ceil(rows.length / maxRowsPerPage));

  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawText(organizationName, { x: margin, y: pageHeight - 34, size: 11, font: bold, color: rgb(0.07, 0.13, 0.22) });
    page.drawText(report.title, { x: margin, y: pageHeight - 54, size: 16, font: bold, color: rgb(0.02, 0.09, 0.18) });
    page.drawText(`Generated ${formatDate(report.metadata.generatedAt)}`, { x: margin, y: pageHeight - 72, size: 9, font: regular, color: rgb(0.28, 0.33, 0.41) });
    page.drawText(`Date range: ${formatDate(report.metadata.startDate)} - ${formatDate(report.metadata.endDate)}`, { x: margin, y: pageHeight - 88, size: 9, font: regular, color: rgb(0.28, 0.33, 0.41) });

    const summaryText = report.summary.map((item) => `${item.label}: ${item.value}`).join("   ");
    if (summaryText) page.drawText(truncate(summaryText, 150), { x: margin, y: pageHeight - 104, size: 8, font: regular, color: rgb(0.18, 0.25, 0.35) });

    let y = tableTop;
    page.drawRectangle({ x: margin, y: y - 4, width: pageWidth - margin * 2, height: rowHeight, color: rgb(0.94, 0.96, 0.98) });
    columns.forEach((column, index) => {
      page.drawText(truncate(column, Math.max(6, Math.floor(colWidth / 6))), { x: margin + index * colWidth + 4, y, size: 7.5, font: bold, color: rgb(0.1, 0.16, 0.25) });
    });

    y -= rowHeight;
    const pageRows = rows.slice(pageIndex * maxRowsPerPage, (pageIndex + 1) * maxRowsPerPage);
    for (const row of pageRows) {
      stringifyRow(row, columns).forEach((value, index) => {
        page.drawText(truncate(value, Math.max(6, Math.floor(colWidth / 6))), { x: margin + index * colWidth + 4, y, size: 7, font: regular, color: rgb(0.08, 0.11, 0.17) });
      });
      y -= rowHeight;
    }

    page.drawText(`Page ${pageIndex + 1} of ${pages}`, { x: pageWidth - margin - 70, y: 20, size: 8, font: regular, color: rgb(0.39, 0.45, 0.55) });
  }

  return Buffer.from(await pdf.save());
}

export async function exportReport(report: ReportData, format: ReportExportFormat, organizationName: string) {
  if (format === "csv") return exportReportCsv(report);
  if (format === "xlsx") return exportReportXlsx(report);
  return exportReportPdf(report, organizationName);
}
