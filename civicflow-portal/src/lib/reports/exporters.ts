import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";
import type { ReportData, ReportRow, ReportType } from "@/lib/reports/report-builder";
import { formatCurrency, formatDate } from "@/lib/formatting";
import { csvCell, sanitizeFormulaCell } from "@/lib/csv-safety";

export type ReportExportFormat = "csv" | "xlsx" | "pdf";

function cell(value: unknown) {
  return String(value ?? "");
}

function fileDate() {
  return new Date().toISOString().slice(0, 10);
}

export function reportFileName(reportType: ReportType, format: ReportExportFormat) {
  return `unestra-${reportType.toLowerCase().replace(/_/g, "-")}-${fileDate()}.${format}`;
}

export function reportContentType(format: ReportExportFormat) {
  if (format === "csv") return "text/csv; charset=utf-8";
  if (format === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/pdf";
}

export function exportReportCsv(report: ReportData) {
  const lines: string[] = [];
  lines.push(csvCell(report.title));
  lines.push(`Generated,${csvCell(formatDate(report.metadata.generatedAt))}`);
  if (report.metadata.startDate || report.metadata.endDate) {
    lines.push(`Date range,${csvCell(formatDate(report.metadata.startDate))} - ${csvCell(formatDate(report.metadata.endDate))}`);
  }
  for (const item of report.summary) lines.push(`${csvCell(item.label)},${csvCell(item.value)}`);
  lines.push("");
  lines.push(report.columns.map(csvCell).join(","));
  for (const row of report.rows) {
    lines.push(report.columns.map((column) => csvCell(row[column])).join(","));
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
    ...report.summary.map((item) => [sanitizeFormulaCell(item.label), sanitizeFormulaCell(item.value)]),
    [],
    report.columns,
    ...report.rows.map((row) => report.columns.map((column) => sanitizeFormulaCell(row[column]))),
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
  const columns = (report.pdfColumns ?? report.columns).slice(0, 10);
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

    // Simple horizontal bar chart (single hue — magnitude-only comparison,
    // no categorical identity to distinguish) drawn under the table on the
    // last page, mirroring the desktop app's pdfkit-drawn income breakdown.
    if (report.chartData && report.chartData.length > 0 && pageIndex === pages - 1) {
      const chartRowHeight = 14;
      const chartGap = 8;
      const chartTitleHeight = 18;
      const neededHeight = chartTitleHeight + report.chartData.length * (chartRowHeight + chartGap);
      if (y - tableBottom > neededHeight) {
        y -= 16;
        page.drawText("INCOME BREAKDOWN", { x: margin, y, size: 9, font: bold, color: rgb(0.02, 0.09, 0.18) });
        y -= chartTitleHeight;

        const labelWidth = 140;
        const valueWidth = 80;
        const barAreaWidth = pageWidth - margin * 2 - labelWidth - valueWidth;
        const maxAmount = Math.max(...report.chartData.map((item) => Math.abs(item.amount)), 1);

        for (const item of report.chartData) {
          const barWidth = Math.max(2, (Math.abs(item.amount) / maxAmount) * barAreaWidth);
          page.drawText(truncate(item.label, 22), { x: margin, y: y + 3, size: 8, font: regular, color: rgb(0.1, 0.16, 0.25) });
          page.drawRectangle({ x: margin + labelWidth, y, width: barAreaWidth, height: chartRowHeight, color: rgb(0.94, 0.96, 0.98) });
          if (barWidth > 0) {
            page.drawRectangle({ x: margin + labelWidth, y, width: barWidth, height: chartRowHeight, color: rgb(0.06, 0.46, 0.43) });
          }
          page.drawText(formatCurrency(item.amount), { x: margin + labelWidth + barAreaWidth + 6, y: y + 3, size: 8, font: bold, color: rgb(0.08, 0.11, 0.17) });
          y -= chartRowHeight + chartGap;
        }
      }
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
