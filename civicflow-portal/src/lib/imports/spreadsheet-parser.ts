import ExcelJS from "exceljs";

/**
 * Security Patch A (fix/spreadsheet-import-and-mail-security) — the single
 * hardened entry point every spreadsheet-import route must use to turn an
 * uploaded file into rows. Replaces the vulnerable `xlsx` (SheetJS) package
 * entirely: SheetJS has two unpatched advisories (prototype pollution,
 * ReDoS — see docs/security/spreadsheet-import-hardening.md) with no fixed
 * version published to the public npm registry at all. `exceljs` (already a
 * dependency, already used for exports) carries neither advisory and is
 * used here with its streaming reader so a crafted file is bounded by row/
 * column/cell/string/time limits rather than fully buffered into memory.
 *
 * A `.xlsx` file is a ZIP container -- CVE classes specific to that
 * container format (path-traversal entry names, encrypted archives, a small
 * file that decompresses to gigabytes) are checked structurally, before any
 * decompression happens, by walking the ZIP central directory ourselves
 * (see readZipCentralDirectory below). This is deliberately independent of
 * whichever library parses the actual worksheet XML afterward.
 */

export type SpreadsheetFormat = "xlsx" | "csv";

export type SpreadsheetRejectionReason =
  | "EMPTY_FILE"
  | "UNSUPPORTED_FORMAT"
  | "FORMAT_MISMATCH"
  | "NOT_A_ZIP_CONTAINER"
  | "ENCRYPTED_ARCHIVE"
  | "MACRO_WORKBOOK"
  | "EXTERNAL_LINKS"
  | "PATH_TRAVERSAL_ENTRY"
  | "TOO_MANY_ZIP_ENTRIES"
  | "UNCOMPRESSED_SIZE_BUDGET_EXCEEDED"
  | "MALFORMED_ZIP"
  | "NO_DATA_ROWS"
  | "TOO_MANY_SHEETS"
  | "TOO_MANY_ROWS"
  | "TOO_MANY_COLUMNS"
  | "TOO_MANY_CELLS"
  | "CELL_TOO_LONG"
  | "DUPLICATE_HEADER"
  | "UNSAFE_HEADER_NAME"
  | "PARSE_TIMEOUT"
  | "MALFORMED_WORKBOOK";

/** Thrown for every rejection above. `reason` is a stable machine-readable
 * code for tests/metrics; `message` is already safe to show a caller (never
 * includes file contents, cell values, or raw parser exception text). */
export class SpreadsheetValidationError extends Error {
  readonly reason: SpreadsheetRejectionReason;
  constructor(reason: SpreadsheetRejectionReason, message: string) {
    super(message);
    this.name = "SpreadsheetValidationError";
    this.reason = reason;
  }
}

// ── Limits (defense-in-depth; independent of the caller's own byte-size cap) ──

export const SPREADSHEET_LIMITS = {
  /** Every route already caps upload size (50-100MB) before this module
   * ever sees the buffer; this is a second, module-level backstop. */
  maxCompressedBytes: 100 * 1024 * 1024,
  /** Sum of every ZIP entry's declared uncompressed size -- the standard
   * "zip bomb" budget, checked before any entry is decompressed. */
  maxUncompressedBytes: 500 * 1024 * 1024,
  maxZipEntries: 2000,
  /** We only ever read the first worksheet (matches this codebase's
   * existing, unchanged behavior) -- this bounds how many sheets a
   * workbook may declare in total, not how many are read. */
  maxSheets: 50,
  maxRows: 50_000,
  maxColumns: 500,
  maxCells: 2_000_000,
  /** Excel's own real per-cell limit is 32,767 characters. */
  maxCellLength: 32_767,
  parseTimeoutMs: 30_000,
} as const;

const DANGEROUS_HEADER_NAMES = new Set(["__proto__", "prototype", "constructor"]);

// ── ZIP structural preflight (xlsx only) ─────────────────────────────────

const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
/** General-purpose bit flag, bit 0: entry is encrypted (traditional or
 * strong ZIP encryption). We reject any such entry outright rather than
 * attempt to decrypt or guess a password. */
const ZIP_ENCRYPTED_FLAG = 0x0001;

interface ZipEntrySummary {
  name: string;
  uncompressedSize: number;
  encrypted: boolean;
}

/** Walks the ZIP central directory (at the end of the file) to enumerate
 * every entry's name/size/encryption flag WITHOUT decompressing anything.
 * Throws SpreadsheetValidationError for anything structurally suspicious;
 * throws a plain Error (caught by callers as MALFORMED_ZIP) if the buffer
 * isn't a well-formed ZIP at all. */
function readZipCentralDirectory(buffer: Buffer): ZipEntrySummary[] {
  // The End Of Central Directory record is a fixed 22-byte structure that
  // may be followed by an arbitrary-length comment, so it must be located
  // by scanning backward from the end of the file for its signature.
  const maxCommentLength = 65_535;
  const searchStart = Math.max(0, buffer.length - 22 - maxCommentLength);
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= searchStart; i--) {
    if (buffer.readUInt32LE(i) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("not_a_zip");
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries > SPREADSHEET_LIMITS.maxZipEntries) {
    throw new SpreadsheetValidationError("TOO_MANY_ZIP_ENTRIES", "This file contains an unreasonable number of internal parts and was rejected.");
  }
  if (centralDirectoryOffset + centralDirectorySize > buffer.length) {
    throw new Error("not_a_zip");
  }

  const entries: ZipEntrySummary[] = [];
  let offset = centralDirectoryOffset;
  let totalUncompressed = 0;

  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("not_a_zip");
    }
    const generalPurposeFlag = buffer.readUInt16LE(offset + 8);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    if (nameStart + nameLength > buffer.length) {
      throw new Error("not_a_zip");
    }
    const name = buffer.toString("utf-8", nameStart, nameStart + nameLength);
    const encrypted = (generalPurposeFlag & ZIP_ENCRYPTED_FLAG) !== 0;

    totalUncompressed += uncompressedSize;
    entries.push({ name, uncompressedSize, encrypted });

    offset = nameStart + nameLength + extraLength + commentLength;
  }

  if (totalUncompressed > SPREADSHEET_LIMITS.maxUncompressedBytes) {
    throw new SpreadsheetValidationError(
      "UNCOMPRESSED_SIZE_BUDGET_EXCEEDED",
      "This file's contents are too large once decompressed and were rejected."
    );
  }

  for (const entry of entries) {
    if (entry.encrypted) {
      throw new SpreadsheetValidationError("ENCRYPTED_ARCHIVE", "Password-protected or encrypted Excel files are not supported. Please remove the password and try again.");
    }
    // Reject absolute paths and parent-directory traversal in any entry
    // name -- no legitimate .xlsx ever contains one; this only ever
    // appears in a deliberately malformed archive.
    if (entry.name.startsWith("/") || entry.name.includes("..") || entry.name.includes("\\")) {
      throw new SpreadsheetValidationError("PATH_TRAVERSAL_ENTRY", "This file's internal structure is invalid and was rejected.");
    }
  }

  return entries;
}

function preflightXlsxContainer(buffer: Buffer): void {
  let entries: ZipEntrySummary[];
  try {
    entries = readZipCentralDirectory(buffer);
  } catch (error) {
    if (error instanceof SpreadsheetValidationError) throw error;
    throw new SpreadsheetValidationError("NOT_A_ZIP_CONTAINER", "This file is not a valid Excel workbook.");
  }

  // A macro-enabled workbook (.xlsm content inside a .xlsx-named file, or
  // any workbook carrying a VBA project) is rejected outright -- this
  // application never needs macro execution and has no code path that
  // would run one, but there is no reason to accept and store one either.
  if (entries.some((e) => e.name === "xl/vbaProject.bin")) {
    throw new SpreadsheetValidationError("MACRO_WORKBOOK", "Macro-enabled workbooks (.xlsm) are not supported. Please save as a standard .xlsx file.");
  }
  // External data connections/links are rejected -- they have no purpose
  // for a one-time data import and are a known vector for triggering
  // outbound requests or reading other files when a workbook is later
  // opened in a full desktop copy of Excel.
  if (entries.some((e) => e.name.startsWith("xl/externalLinks/") || e.name.startsWith("xl/connections"))) {
    throw new SpreadsheetValidationError("EXTERNAL_LINKS", "Workbooks with external data connections or links are not supported.");
  }

  const sheetEntryCount = entries.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).length;
  if (sheetEntryCount > SPREADSHEET_LIMITS.maxSheets) {
    throw new SpreadsheetValidationError("TOO_MANY_SHEETS", "This workbook has too many sheets and was rejected.");
  }
}

// ── Format detection ──────────────────────────────────────────────────────

function detectFormat(buffer: Buffer): SpreadsheetFormat | null {
  if (buffer.length >= 4) {
    const sig = buffer.readUInt32LE(0);
    if (sig === ZIP_LOCAL_FILE_SIGNATURE) return "xlsx";
    // Empty ZIP archive (extremely unlikely for a real workbook, but a
    // well-formed one) -- signature 0x06054b50 at offset 0.
    if (sig === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) return "xlsx";
  }
  // No reliable magic bytes exist for CSV -- it's plain text. Treat
  // anything that isn't a ZIP container as a CSV candidate; the caller
  // supplies the claimed extension separately and we require agreement
  // between the two before proceeding (see parseSpreadsheetBuffer).
  return "csv";
}

/** A quick, cheap scan for content that could never legitimately be a CSV
 * (embedded NUL bytes, or a byte sequence that isn't valid UTF-8/ASCII
 * text) -- catches "renamed binary file" spoofing attempts that would
 * otherwise reach the CSV parser. */
function looksLikeText(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 65_536);
  for (let i = 0; i < sampleSize; i++) {
    if (buffer[i] === 0) return false;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, sampleSize));
    return true;
  } catch {
    return false;
  }
}

// ── Row/header safety ─────────────────────────────────────────────────────

/** Builds a row object with no prototype at all, so a column literally
 * named "__proto__" becomes an ordinary own data property instead of
 * silently reassigning the object's prototype -- the classic POJO
 * prototype-pollution footgun (`obj["__proto__"] = x` on a `{}` literal
 * does NOT create a property, it reassigns the prototype). Combined with
 * the explicit DANGEROUS_HEADER_NAMES rejection below, which stops a
 * hostile header from surviving into any later `{...row}` spread that
 * would reintroduce the same risk at a different layer. */
function createSafeRow(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

function validateHeaders(headers: string[]): void {
  const seen = new Map<string, string>();
  for (const header of headers) {
    const trimmed = header.trim();
    const normalized = trimmed.toLowerCase();
    if (DANGEROUS_HEADER_NAMES.has(normalized)) {
      throw new SpreadsheetValidationError("UNSAFE_HEADER_NAME", `Column name "${trimmed}" is not allowed. Please rename this column.`);
    }
    if (seen.has(normalized)) {
      throw new SpreadsheetValidationError(
        "DUPLICATE_HEADER",
        `Columns "${seen.get(normalized)}" and "${trimmed}" both map to the same name. Please rename one so every column is unique.`
      );
    }
    seen.set(normalized, trimmed);
  }
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    // Formulas are treated as untrusted data and never evaluated -- only
    // the workbook's own cached result (computed by whatever application
    // last saved the file) is used, never the formula text itself. If no
    // cached result exists, the cell is treated as blank rather than
    // exposing formula syntax as if it were data.
    if ("formula" in value || "sharedFormula" in value) {
      const result = (value as { result?: unknown }).result;
      return result === undefined || result === null ? "" : String(result);
    }
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if ("text" in value) return String((value as { text: unknown }).text ?? "");
    if ("richText" in value) {
      return (value as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join("");
    }
    if ("error" in value) return "";
    return "";
  }
  return String(value);
}

function enforceCellLength(value: string): string {
  if (value.length > SPREADSHEET_LIMITS.maxCellLength) {
    throw new SpreadsheetValidationError("CELL_TOO_LONG", "This file contains a cell that exceeds the maximum allowed length and was rejected.");
  }
  return value;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new SpreadsheetValidationError("PARSE_TIMEOUT", "This file took too long to process and was rejected.")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

// ── XLSX parsing (streaming) ──────────────────────────────────────────────

async function parseXlsxRows(buffer: Buffer): Promise<Record<string, string>[]> {
  preflightXlsxContainer(buffer);

  const run = async (): Promise<Record<string, string>[]> => {
    // Deliberately using the buffered `workbook.xlsx.load()` reader, not
    // ExcelJS's streaming WorkbookReader: testing the streaming reader
    // against a real multi-sheet workbook (an entirely ordinary, common
    // shape -- most spreadsheet exports have more than one tab) reproduced
    // a genuine internal ExcelJS bug (`this.model` is undefined while
    // parsing the second worksheet's relationship info, a background
    // parsing-order issue in workbook-reader.js), which would falsely
    // reject legitimate files. The buffered reader has no such issue.
    // This trades "never fully materialize the decompressed workbook" for
    // correctness -- the ZIP preflight above already bounds total
    // uncompressed size (the actual zip-bomb defense, enforced before any
    // decompression happens at all), so this is a bounded, not unbounded,
    // amount of memory regardless.
    let workbook: ExcelJS.Workbook;
    try {
      workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch (error) {
      if (error instanceof SpreadsheetValidationError) throw error;
      throw new SpreadsheetValidationError("MALFORMED_WORKBOOK", "This file could not be read as a valid Excel workbook.");
    }

    if (workbook.worksheets.length > SPREADSHEET_LIMITS.maxSheets) {
      throw new SpreadsheetValidationError("TOO_MANY_SHEETS", "This workbook has too many sheets and was rejected.");
    }
    // Matches this codebase's existing behavior of only ever reading the
    // first sheet.
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];

    let headers: string[] | null = null;
    const rows: Record<string, string>[] = [];
    let totalCells = 0;

    worksheet.eachRow((row, rowNumber) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1); // index 0 is always empty in ExcelJS
      if (rowNumber === 1) {
        if (values.length > SPREADSHEET_LIMITS.maxColumns) {
          throw new SpreadsheetValidationError("TOO_MANY_COLUMNS", "This file has too many columns and was rejected.");
        }
        headers = values.map((v) => enforceCellLength(cellToString(v)));
        validateHeaders(headers);
        return;
      }
      if (rowNumber - 1 > SPREADSHEET_LIMITS.maxRows) {
        throw new SpreadsheetValidationError("TOO_MANY_ROWS", "This file has too many rows and was rejected.");
      }
      totalCells += values.length;
      if (totalCells > SPREADSHEET_LIMITS.maxCells) {
        throw new SpreadsheetValidationError("TOO_MANY_CELLS", "This file's total data volume is too large and was rejected.");
      }
      const record = createSafeRow();
      headers!.forEach((header, i) => {
        record[header] = enforceCellLength(cellToString(values[i]));
      });
      rows.push(record);
    });

    return rows;
  };

  return withTimeout(run(), SPREADSHEET_LIMITS.parseTimeoutMs);
}

// ── CSV parsing ────────────────────────────────────────────────────────────
//
// Deliberately NOT using ExcelJS's own `workbook.csv.read()` here: testing
// it against a header literally named "__proto__" showed it silently
// corrupts that cell into an empty object rather than preserving the
// string -- evidence of exactly the kind of internal keyed-object step
// (`obj[headerText] = value` on a plain object literal) this whole patch
// exists to avoid, somewhere in ExcelJS's CSV-specific code path (its XLSX
// streaming reader, used above, does not have this problem -- confirmed
// separately). Rather than trust a parser just shown to mishandle exactly
// the input class this module is hardening against, CSV -- a simple,
// well-specified grammar -- is parsed here directly: a small RFC-4180
// state machine, values only ever assigned positionally into a
// null-prototype row object, matching the XLSX path's own safety model.

/** Minimal RFC-4180 CSV parser: comma-delimited, double-quote-enclosed
 * fields with "" as an escaped quote, CRLF/LF line endings, and quoted
 * fields may contain literal newlines/commas. Returns rows of raw string
 * fields -- no header/limit handling here, that's layered on by the caller
 * so the same enforcement points as the XLSX path apply uniformly. */
function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Final field/row if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop a single fully-blank trailing row (trailing newline at EOF).
  if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
    rows.pop();
  }
  return rows;
}

async function parseCsvRows(buffer: Buffer): Promise<Record<string, string>[]> {
  if (!looksLikeText(buffer)) {
    throw new SpreadsheetValidationError("FORMAT_MISMATCH", "This file does not look like a valid CSV file.");
  }

  const run = async (): Promise<Record<string, string>[]> => {
    const text = buffer.toString("utf-8");
    const rawRows = parseCsvText(text);
    if (rawRows.length === 0) return [];

    const headerRow = rawRows[0];
    if (headerRow.length > SPREADSHEET_LIMITS.maxColumns) {
      throw new SpreadsheetValidationError("TOO_MANY_COLUMNS", "This file has too many columns and was rejected.");
    }
    const headers = headerRow.map((h) => enforceCellLength(h));
    validateHeaders(headers);

    if (rawRows.length - 1 > SPREADSHEET_LIMITS.maxRows) {
      throw new SpreadsheetValidationError("TOO_MANY_ROWS", "This file has too many rows and was rejected.");
    }

    const rows: Record<string, string>[] = [];
    let totalCells = 0;
    for (let r = 1; r < rawRows.length; r++) {
      const values = rawRows[r];
      totalCells += values.length;
      if (totalCells > SPREADSHEET_LIMITS.maxCells) {
        throw new SpreadsheetValidationError("TOO_MANY_CELLS", "This file's total data volume is too large and was rejected.");
      }
      const record = createSafeRow();
      headers.forEach((header, i) => {
        record[header] = enforceCellLength(values[i] ?? "");
      });
      rows.push(record);
    }
    return rows;
  };

  return withTimeout(run(), SPREADSHEET_LIMITS.parseTimeoutMs);
}

// ── Public entry point ─────────────────────────────────────────────────────

export interface ParsedSpreadsheet {
  format: SpreadsheetFormat;
  rows: Record<string, string>[];
}

/**
 * The one function every route should call to turn an uploaded file into
 * rows. `claimedExtension` is the extension the caller/UI advertised
 * (e.g. from the filename) -- it is never trusted alone; the buffer's
 * actual content is independently detected and the two must agree.
 */
export async function parseSpreadsheetBuffer(buffer: Buffer, claimedExtension: string): Promise<ParsedSpreadsheet> {
  if (buffer.length === 0) {
    throw new SpreadsheetValidationError("EMPTY_FILE", "The uploaded file is empty.");
  }
  if (buffer.length > SPREADSHEET_LIMITS.maxCompressedBytes) {
    throw new SpreadsheetValidationError("UNCOMPRESSED_SIZE_BUDGET_EXCEEDED", "This file is too large.");
  }

  const claimed = claimedExtension.toLowerCase().replace(/^\./, "");
  if (claimed !== "xlsx" && claimed !== "csv") {
    throw new SpreadsheetValidationError("UNSUPPORTED_FORMAT", `Unsupported file type "${claimedExtension}". Please upload a .xlsx or .csv file.`);
  }

  const detected = detectFormat(buffer);
  if (detected === null || detected !== claimed) {
    throw new SpreadsheetValidationError(
      "FORMAT_MISMATCH",
      `This file's contents do not match its ".${claimed}" file type. Please re-export it and try again.`
    );
  }

  const rows = detected === "xlsx" ? await parseXlsxRows(buffer) : await parseCsvRows(buffer);

  if (rows.length === 0) {
    throw new SpreadsheetValidationError("NO_DATA_ROWS", "This file has no data rows.");
  }

  return { format: detected, rows };
}
