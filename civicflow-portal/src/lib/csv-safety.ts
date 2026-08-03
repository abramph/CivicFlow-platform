/**
 * Shared CSV/Excel formula-injection protection. A cell whose text starts
 * with =, +, -, @, a tab, or a carriage return is interpreted as a formula
 * by Excel/Google Sheets/LibreOffice when the file is later opened — a
 * member/report field like a name or note containing `=cmd|'/c calc'!A1`
 * (or a data-exfiltration formula) would otherwise execute silently for
 * whoever opens the export. Prefixing a literal apostrophe forces the cell
 * to be read as plain text instead.
 *
 * Previously duplicated ad hoc in two export routes (events/meetings
 * attendance) and entirely absent from the members export, financial
 * report exports, and admin SMS log export — consolidated here so every
 * export gets the same protection instead of relying on each route
 * remembering to add it.
 */
export function sanitizeFormulaCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** sanitizeFormulaCell() + standard CSV quoting (wraps in quotes and escapes embedded quotes when the value contains a comma, quote, or newline). */
export function csvCell(value: unknown): string {
  const text = sanitizeFormulaCell(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}
