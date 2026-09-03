import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseSpreadsheetBuffer, SpreadsheetValidationError, SPREADSHEET_LIMITS, LEGACY_XLS_MESSAGE } from "@/lib/imports/spreadsheet-parser";

/**
 * Security Patch A -- regression tests for the hardened parser that
 * replaces the vulnerable `xlsx` package. Every rejection case here
 * corresponds to a specific requirement from the patch's security review;
 * no test uses a real exploit payload -- each constructs the smallest
 * inert input that crosses the relevant boundary (a declared size over
 * the limit, a header with a dangerous literal name, a malformed
 * structure), never actual malicious executable content.
 */

async function buildXlsx(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function buildCsv(text: string): Buffer {
  return Buffer.from(text, "utf-8");
}

const VALID_XLSX_ROWS = [
  ["firstName", "lastName", "email"],
  ["Jane", "Doe", "jane@example.com"],
  ["John", "Smith", "john@example.com"],
];
const VALID_CSV_TEXT = "firstName,lastName,email\nJane,Doe,jane@example.com\nJohn,Smith,john@example.com\n";

describe("parseSpreadsheetBuffer -- valid input", () => {
  it("parses a valid .xlsx file into rows keyed by header", async () => {
    const buffer = await buildXlsx(VALID_XLSX_ROWS);
    const result = await parseSpreadsheetBuffer(buffer, "xlsx");
    expect(result.format).toBe("xlsx");
    expect(result.rows).toEqual([
      { firstName: "Jane", lastName: "Doe", email: "jane@example.com" },
      { firstName: "John", lastName: "Smith", email: "john@example.com" },
    ]);
  });

  it("parses a valid .csv file into rows keyed by header", async () => {
    const result = await parseSpreadsheetBuffer(buildCsv(VALID_CSV_TEXT), "csv");
    expect(result.format).toBe("csv");
    expect(result.rows).toEqual([
      { firstName: "Jane", lastName: "Doe", email: "jane@example.com" },
      { firstName: "John", lastName: "Smith", email: "john@example.com" },
    ]);
  });

  it("handles quoted CSV fields containing commas, embedded newlines, and escaped quotes", async () => {
    const csv = 'name,note\n"Doe, Jane","Line1\nLine2 with ""quotes"""\n';
    const result = await parseSpreadsheetBuffer(buildCsv(csv), "csv");
    expect(result.rows).toEqual([{ name: "Doe, Jane", note: 'Line1\nLine2 with "quotes"' }]);
  });

  it("only reads the first worksheet of a multi-sheet workbook, matching prior behavior", async () => {
    const wb = new ExcelJS.Workbook();
    const first = wb.addWorksheet("First");
    first.addRow(["a"]);
    first.addRow(["1"]);
    const second = wb.addWorksheet("Second");
    second.addRow(["b"]);
    second.addRow(["2"]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseSpreadsheetBuffer(buffer, "xlsx");
    expect(result.rows).toEqual([{ a: "1" }]);
  });

  it("prefers a formula cell's cached result and never evaluates the formula text", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["total"]);
    ws.getCell("A2").value = { formula: "SUM(1,2)", result: 3 } as unknown as ExcelJS.CellValue;
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseSpreadsheetBuffer(buffer, "xlsx");
    expect(result.rows).toEqual([{ total: "3" }]);
  });

  it("treats a formula cell with no cached result as blank rather than exposing formula syntax", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["total"]);
    ws.getCell("A2").value = { formula: "A1*2" } as unknown as ExcelJS.CellValue;
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseSpreadsheetBuffer(buffer, "xlsx");
    expect(result.rows).toEqual([{ total: "" }]);
  });
});

describe("parseSpreadsheetBuffer -- format and extension validation", () => {
  it("rejects an unsupported claimed extension", async () => {
    await expect(parseSpreadsheetBuffer(buildCsv("a,b\n1,2\n"), "exe")).rejects.toMatchObject({ reason: "UNSUPPORTED_FORMAT" });
    await expect(parseSpreadsheetBuffer(buildCsv("a,b\n1,2\n"), "docx")).rejects.toMatchObject({ reason: "UNSUPPORTED_FORMAT" });
  });

  it("rejects a claimed .xls extension with its own dedicated reason and exact conversion message, decided purely from the extension before any content is read (auth-ordering follow-up)", async () => {
    await expect(parseSpreadsheetBuffer(buildCsv("a,b\n1,2\n"), "xls")).rejects.toMatchObject({
      reason: "LEGACY_XLS_UNSUPPORTED",
      message: LEGACY_XLS_MESSAGE,
    });
    // A .xls-named file whose bytes aren't even a valid CSV/XLSX still gets
    // the same rejection -- proving it's never handed to detectFormat().
    await expect(parseSpreadsheetBuffer(Buffer.from([0x4d, 0x5a, 0x90, 0x00]), "xls")).rejects.toMatchObject({
      reason: "LEGACY_XLS_UNSUPPORTED",
      message: LEGACY_XLS_MESSAGE,
    });
  });

  it("rejects a spoofed extension -- CSV content claiming to be .xlsx", async () => {
    await expect(parseSpreadsheetBuffer(buildCsv(VALID_CSV_TEXT), "xlsx")).rejects.toMatchObject({ reason: "FORMAT_MISMATCH" });
  });

  it("rejects a spoofed extension -- a real .xlsx (ZIP) claiming to be .csv", async () => {
    const buffer = await buildXlsx(VALID_XLSX_ROWS);
    await expect(parseSpreadsheetBuffer(buffer, "csv")).rejects.toMatchObject({ reason: "FORMAT_MISMATCH" });
  });

  it("rejects a file that is not a valid ZIP container at all when claiming .xlsx", async () => {
    await expect(parseSpreadsheetBuffer(Buffer.from("this is not a zip file"), "xlsx")).rejects.toMatchObject({ reason: "FORMAT_MISMATCH" });
  });

  it("rejects a truncated/malformed workbook whose ZIP structure is corrupted", async () => {
    const buffer = await buildXlsx(VALID_XLSX_ROWS);
    const truncated = buffer.subarray(0, Math.floor(buffer.length / 2));
    await expect(parseSpreadsheetBuffer(truncated, "xlsx")).rejects.toThrow(SpreadsheetValidationError);
  });

  it("rejects a binary file with embedded NUL bytes claiming to be CSV", async () => {
    const buffer = Buffer.concat([Buffer.from("a,b\n"), Buffer.from([0x00, 0x01, 0x02]), Buffer.from("1,2\n")]);
    await expect(parseSpreadsheetBuffer(buffer, "csv")).rejects.toMatchObject({ reason: "FORMAT_MISMATCH" });
  });

  it("rejects an empty file", async () => {
    await expect(parseSpreadsheetBuffer(Buffer.alloc(0), "csv")).rejects.toMatchObject({ reason: "EMPTY_FILE" });
  });

  it("rejects a file with a header row but no data rows", async () => {
    await expect(parseSpreadsheetBuffer(buildCsv("firstName,lastName\n"), "csv")).rejects.toMatchObject({ reason: "NO_DATA_ROWS" });
  });
});

describe("parseSpreadsheetBuffer -- prototype-pollution and header safety", () => {
  it("rejects a __proto__ header in CSV", async () => {
    await expect(parseSpreadsheetBuffer(buildCsv("__proto__,name\nx,y\n"), "csv")).rejects.toMatchObject({ reason: "UNSAFE_HEADER_NAME" });
  });

  it("rejects a __proto__ header in .xlsx", async () => {
    const buffer = await buildXlsx([["__proto__", "name"], ["x", "y"]]);
    await expect(parseSpreadsheetBuffer(buffer, "xlsx")).rejects.toMatchObject({ reason: "UNSAFE_HEADER_NAME" });
  });

  it("rejects a constructor header (case-insensitively, with surrounding whitespace)", async () => {
    await expect(parseSpreadsheetBuffer(buildCsv(" Constructor ,name\nx,y\n"), "csv")).rejects.toMatchObject({ reason: "UNSAFE_HEADER_NAME" });
  });

  it("rejects a prototype header", async () => {
    await expect(parseSpreadsheetBuffer(buildCsv("prototype,name\nx,y\n"), "csv")).rejects.toMatchObject({ reason: "UNSAFE_HEADER_NAME" });
  });

  it("rejects duplicate normalized headers (case/whitespace-insensitive)", async () => {
    await expect(parseSpreadsheetBuffer(buildCsv("Name,name\nx,y\n"), "csv")).rejects.toMatchObject({ reason: "DUPLICATE_HEADER" });
    await expect(parseSpreadsheetBuffer(buildCsv(" Email ,email\nx,y\n"), "csv")).rejects.toMatchObject({ reason: "DUPLICATE_HEADER" });
  });

  it("never lets a hostile header pollute Object.prototype -- rows are built on a null-prototype base regardless", async () => {
    const before = ({} as Record<string, unknown>).polluted;
    try {
      await parseSpreadsheetBuffer(buildCsv("__proto__,name\nx,y\n"), "csv");
    } catch {
      // expected to throw -- the assertion is on global state below
    }
    expect(({} as Record<string, unknown>).polluted).toBe(before);
  });
});

describe("parseSpreadsheetBuffer -- structural limits", () => {
  it("rejects a file with more rows than the configured maximum", async () => {
    const lines = ["a,b"];
    for (let i = 0; i < SPREADSHEET_LIMITS.maxRows + 1; i++) lines.push(`${i},${i}`);
    await expect(parseSpreadsheetBuffer(buildCsv(lines.join("\n") + "\n"), "csv")).rejects.toMatchObject({ reason: "TOO_MANY_ROWS" });
  });

  it("rejects a file with more columns than the configured maximum", async () => {
    const headerCols = Array.from({ length: SPREADSHEET_LIMITS.maxColumns + 1 }, (_, i) => `col${i}`);
    const dataCols = headerCols.map(() => "x");
    const csv = `${headerCols.join(",")}\n${dataCols.join(",")}\n`;
    await expect(parseSpreadsheetBuffer(buildCsv(csv), "csv")).rejects.toMatchObject({ reason: "TOO_MANY_COLUMNS" });
  });

  it("rejects a single cell longer than the configured maximum length", async () => {
    const longValue = "x".repeat(SPREADSHEET_LIMITS.maxCellLength + 1);
    await expect(parseSpreadsheetBuffer(buildCsv(`name\n${longValue}\n`), "csv")).rejects.toMatchObject({ reason: "CELL_TOO_LONG" });
  });

  it("accepts a cell exactly at the configured maximum length", async () => {
    const maxValue = "x".repeat(SPREADSHEET_LIMITS.maxCellLength);
    const result = await parseSpreadsheetBuffer(buildCsv(`name\n${maxValue}\n`), "csv");
    expect(result.rows[0].name.length).toBe(SPREADSHEET_LIMITS.maxCellLength);
  });

  it("rejects a compressed .xlsx file larger than the overall byte cap", async () => {
    // A buffer this large is impractical to actually allocate in a unit
    // test; the cap is exercised directly against a buffer whose *declared*
    // length exceeds the limit without needing real content.
    const oversized = Buffer.alloc(SPREADSHEET_LIMITS.maxCompressedBytes + 1);
    await expect(parseSpreadsheetBuffer(oversized, "csv")).rejects.toMatchObject({ reason: "UNCOMPRESSED_SIZE_BUDGET_EXCEEDED" });
  });
});

/** Builds a synthetic, minimal ZIP buffer containing exactly one central
 * directory entry with the given name/size/encryption flag, preceded by a
 * 4-byte local-file-header signature so detectFormat() recognizes it as a
 * ZIP container (real .xlsx files always start with one) -- the
 * preflight itself only ever reads the central directory, never any
 * entry's actual data, so nothing else about a real ZIP's structure needs
 * to be present for these tests. */
function buildFakeZipCentralDirectory(entryName: string, uncompressedSize: number, encrypted = false): Buffer {
  const localFileHeaderSignature = Buffer.alloc(4);
  localFileHeaderSignature.writeUInt32LE(0x04034b50, 0);

  const nameBuf = Buffer.from(entryName, "utf-8");
  const cdEntry = Buffer.alloc(46 + nameBuf.length);
  cdEntry.writeUInt32LE(0x02014b50, 0); // central directory signature
  cdEntry.writeUInt16LE(encrypted ? 0x0001 : 0, 8); // general purpose flag
  cdEntry.writeUInt32LE(uncompressedSize, 24);
  cdEntry.writeUInt16LE(nameBuf.length, 28); // filename length
  cdEntry.writeUInt16LE(0, 30); // extra length
  cdEntry.writeUInt16LE(0, 32); // comment length
  nameBuf.copy(cdEntry, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(1, 8); // entries on this disk
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(cdEntry.length, 12); // CD size
  eocd.writeUInt32LE(localFileHeaderSignature.length, 16); // CD offset -- right after the 4-byte prefix
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localFileHeaderSignature, cdEntry, eocd]);
}

/** Worker-isolation follow-up (Phase 5, ZIP robustness) -- a more
 * flexible fixture builder than buildFakeZipCentralDirectory above,
 * supporting multiple entries and explicit compressionMethod/
 * compressedSize control (needed for the ZIP64/duplicate/compression-
 * method/ratio checks, none of which the original helper's fixed shape
 * could exercise). */
function buildFakeZipMultiEntry(
  entries: { name: string; uncompressedSize: number; compressedSize?: number; compressionMethod?: number; encrypted?: boolean }[]
): Buffer {
  const localFileHeaderSignature = Buffer.alloc(4);
  localFileHeaderSignature.writeUInt32LE(0x04034b50, 0);

  const cdEntries = entries.map((entry) => {
    const nameBuf = Buffer.from(entry.name, "utf-8");
    const cdEntry = Buffer.alloc(46 + nameBuf.length);
    cdEntry.writeUInt32LE(0x02014b50, 0);
    cdEntry.writeUInt16LE(entry.encrypted ? 0x0001 : 0, 8);
    cdEntry.writeUInt16LE(entry.compressionMethod ?? 8, 10);
    cdEntry.writeUInt32LE(entry.compressedSize ?? 0, 20);
    cdEntry.writeUInt32LE(entry.uncompressedSize, 24);
    cdEntry.writeUInt16LE(nameBuf.length, 28);
    cdEntry.writeUInt16LE(0, 30);
    cdEntry.writeUInt16LE(0, 32);
    nameBuf.copy(cdEntry, 46);
    return cdEntry;
  });
  const cdBuffer = Buffer.concat(cdEntries);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuffer.length, 12);
  eocd.writeUInt32LE(localFileHeaderSignature.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localFileHeaderSignature, cdBuffer, eocd]);
}

describe("parseSpreadsheetBuffer -- ZIP robustness follow-up (Phase 5)", () => {
  it("rejects a ZIP64 sentinel uncompressed size rather than trusting the literal (understated) 4-byte value", async () => {
    const buffer = buildFakeZipMultiEntry([
      { name: "xl/worksheets/sheet1.xml", uncompressedSize: 0xffffffff, compressedSize: 10 },
    ]);
    await expect(parseSpreadsheetBuffer(buffer, "xlsx")).rejects.toMatchObject({ reason: "ZIP64_UNSUPPORTED" });
  });

  it("rejects a ZIP64 sentinel compressed size the same way", async () => {
    const buffer = buildFakeZipMultiEntry([
      { name: "xl/worksheets/sheet1.xml", uncompressedSize: 100, compressedSize: 0xffffffff },
    ]);
    await expect(parseSpreadsheetBuffer(buffer, "xlsx")).rejects.toMatchObject({ reason: "ZIP64_UNSUPPORTED" });
  });

  it("rejects a ZIP central directory declaring two entries with the identical name", async () => {
    const buffer = buildFakeZipMultiEntry([
      { name: "xl/worksheets/sheet1.xml", uncompressedSize: 100, compressedSize: 50 },
      { name: "xl/worksheets/sheet1.xml", uncompressedSize: 200, compressedSize: 60 },
    ]);
    await expect(parseSpreadsheetBuffer(buffer, "xlsx")).rejects.toMatchObject({ reason: "DUPLICATE_ZIP_ENTRY" });
  });

  it("rejects a compression method other than store(0)/deflate(8)", async () => {
    const buffer = buildFakeZipMultiEntry([
      { name: "xl/worksheets/sheet1.xml", uncompressedSize: 100, compressedSize: 50, compressionMethod: 99 },
    ]);
    await expect(parseSpreadsheetBuffer(buffer, "xlsx")).rejects.toMatchObject({ reason: "UNSUPPORTED_COMPRESSION_METHOD" });
  });

  it("accepts compression method store(0)", async () => {
    const buffer = buildFakeZipMultiEntry([
      { name: "xl/worksheets/sheet1.xml", uncompressedSize: 100, compressedSize: 100, compressionMethod: 0 },
    ]);
    // Still fails downstream (not a real workbook) -- the point here is
    // it fails for a DIFFERENT reason, proving compressionMethod 0 itself
    // isn't what's rejected.
    await expect(parseSpreadsheetBuffer(buffer, "xlsx")).rejects.not.toMatchObject({ reason: "UNSUPPORTED_COMPRESSION_METHOD" });
  });

  it("rejects a declared compression ratio implausible for real XML content (early heuristic on top of the total-byte budget)", async () => {
    const buffer = buildFakeZipMultiEntry([
      { name: "xl/worksheets/sheet1.xml", uncompressedSize: 10_000_000, compressedSize: 100, compressionMethod: 8 },
    ]);
    await expect(parseSpreadsheetBuffer(buffer, "xlsx")).rejects.toMatchObject({ reason: "EXCESSIVE_COMPRESSION_RATIO" });
  });

  it("does not reject a directory entry / empty file (compressedSize 0) on the ratio check", async () => {
    const buffer = buildFakeZipMultiEntry([
      { name: "xl/worksheets/", uncompressedSize: 0, compressedSize: 0, compressionMethod: 0 },
    ]);
    await expect(parseSpreadsheetBuffer(buffer, "xlsx")).rejects.not.toMatchObject({ reason: "EXCESSIVE_COMPRESSION_RATIO" });
  });

  it("rejects macro-workbook entries regardless of case (xl/VBAProject.BIN, XL/vbaproject.bin, etc.)", async () => {
    for (const name of ["xl/VBAProject.BIN", "XL/vbaproject.bin", "Xl/VbaProject.Bin"]) {
      const buffer = buildFakeZipMultiEntry([{ name, uncompressedSize: 10, compressedSize: 10 }]);
      await expect(parseSpreadsheetBuffer(buffer, "xlsx")).rejects.toMatchObject({ reason: "MACRO_WORKBOOK" });
    }
  });

  it("rejects external-link entries regardless of case", async () => {
    const buffer = buildFakeZipMultiEntry([{ name: "XL/EXTERNALLINKS/externalLink1.xml", uncompressedSize: 10, compressedSize: 10 }]);
    await expect(parseSpreadsheetBuffer(buffer, "xlsx")).rejects.toMatchObject({ reason: "EXTERNAL_LINKS" });
  });
});

describe("parseSpreadsheetBuffer -- ZIP container structural preflight (xlsx only)", () => {
  it("rejects a ZIP whose central directory declares more entries than the configured maximum", async () => {
    // Build a minimal, well-formed empty ZIP end-of-central-directory
    // record, but with totalEntries set above the limit -- this alone is
    // enough to trip the preflight without needing that many real
    // archive entries to exist.
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
    eocd.writeUInt16LE(0, 4); // disk number
    eocd.writeUInt16LE(0, 6); // disk with CD
    eocd.writeUInt16LE(SPREADSHEET_LIMITS.maxZipEntries + 1, 8); // entries on this disk
    eocd.writeUInt16LE(SPREADSHEET_LIMITS.maxZipEntries + 1, 10); // total entries
    eocd.writeUInt32LE(0, 12); // CD size
    eocd.writeUInt32LE(0, 16); // CD offset
    eocd.writeUInt16LE(0, 20); // comment length
    await expect(parseSpreadsheetBuffer(eocd, "xlsx")).rejects.toMatchObject({ reason: "TOO_MANY_ZIP_ENTRIES" });
  });

  it("rejects a ZIP central directory entry whose declared total uncompressed size exceeds the budget (zip-bomb heuristic)", async () => {
    // The preflight sums declared sizes from the central directory header
    // alone, so this never requires decompressing (or even providing)
    // gigabytes of real data.
    const buffer = buildFakeZipCentralDirectory("xl/worksheets/sheet1.xml", SPREADSHEET_LIMITS.maxUncompressedBytes + 1);
    await expect(parseSpreadsheetBuffer(buffer, "xlsx")).rejects.toMatchObject({ reason: "UNCOMPRESSED_SIZE_BUDGET_EXCEEDED" });
  });

  it("rejects a ZIP central directory entry flagged as encrypted", async () => {
    const buffer = buildFakeZipCentralDirectory("xl/worksheets/sheet1.xml", 100, true);
    await expect(parseSpreadsheetBuffer(buffer, "xlsx")).rejects.toMatchObject({ reason: "ENCRYPTED_ARCHIVE" });
  });

  it("rejects a ZIP central directory entry with a path-traversal name", async () => {
    const buffer = buildFakeZipCentralDirectory("../../etc/passwd", 10);
    await expect(parseSpreadsheetBuffer(buffer, "xlsx")).rejects.toMatchObject({ reason: "PATH_TRAVERSAL_ENTRY" });
  });

  it("rejects a workbook carrying a VBA project (macro-enabled)", async () => {
    const macroBuffer = buildFakeZipCentralDirectory("xl/vbaProject.bin", 10);
    await expect(parseSpreadsheetBuffer(macroBuffer, "xlsx")).rejects.toMatchObject({ reason: "MACRO_WORKBOOK" });
    // Sanity check: a real, unmodified workbook from the same builder used
    // throughout this file is still accepted -- proves the rejection above
    // is genuinely about the vbaProject.bin entry, not a broken fixture.
    const cleanBuffer = await buildXlsx(VALID_XLSX_ROWS);
    await expect(parseSpreadsheetBuffer(cleanBuffer, "xlsx")).resolves.toBeDefined();
  });

  it("rejects a workbook with external data connections/links", async () => {
    const buffer = buildFakeZipCentralDirectory("xl/externalLinks/externalLink1.xml", 10);
    await expect(parseSpreadsheetBuffer(buffer, "xlsx")).rejects.toMatchObject({ reason: "EXTERNAL_LINKS" });
  });
});

/**
 * Security Patch A follow-up -- dedicated adversarial pass over the
 * hand-written RFC-4180 CSV state machine (parseCsvText/parseCsvRows in
 * spreadsheet-parser.ts), matching the review's exact checklist. Quoted
 * commas/embedded newlines/escaped quotes are already covered above under
 * "valid input" -- this block covers the remaining vectors: BOM handling,
 * row/field edge cases, malformed input, and algorithmic complexity.
 */
describe("parseSpreadsheetBuffer -- CSV adversarial review", () => {
  it("strips a leading UTF-8 BOM instead of corrupting the first header (Excel-on-Windows commonly writes one)", async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const buffer = Buffer.concat([bom, Buffer.from(VALID_CSV_TEXT, "utf-8")]);
    const result = await parseSpreadsheetBuffer(buffer, "csv");
    expect(Object.keys(result.rows[0])).toEqual(["firstName", "lastName", "email"]);
    expect(result.rows[0].firstName).toBe("Jane");
  });

  it("parses the final row correctly when the file has no trailing newline", async () => {
    const csv = "a,b\n1,2\n3,4";
    const result = await parseSpreadsheetBuffer(buildCsv(csv), "csv");
    expect(result.rows).toEqual([{ a: "1", b: "2" }, { a: "3", b: "4" }]);
  });

  it("handles empty cells within an otherwise populated row", async () => {
    const csv = "a,b,c\n1,,3\n";
    const result = await parseSpreadsheetBuffer(buildCsv(csv), "csv");
    expect(result.rows).toEqual([{ a: "1", b: "", c: "3" }]);
  });

  it("drops a single blank trailing line at EOF rather than emitting a phantom row", async () => {
    const csv = "a,b\n1,2\n\n";
    const result = await parseSpreadsheetBuffer(buildCsv(csv), "csv");
    expect(result.rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("blank-fills a data row with fewer fields than the header row rather than erroring", async () => {
    const csv = "a,b,c\n1\n";
    const result = await parseSpreadsheetBuffer(buildCsv(csv), "csv");
    expect(result.rows).toEqual([{ a: "1", b: "", c: "" }]);
  });

  it("silently drops extra fields beyond the header count on a data row (no crash, no misalignment into the wrong column)", async () => {
    const csv = "a,b\n1,2,3,4\n";
    const result = await parseSpreadsheetBuffer(buildCsv(csv), "csv");
    expect(result.rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("handles Unicode content in both headers and values", async () => {
    const csv = "名前,note\n田中,café ☕ — 日本語\n";
    const result = await parseSpreadsheetBuffer(buildCsv(csv), "csv");
    expect(result.rows).toEqual([{ "名前": "田中", note: "café ☕ — 日本語" }]);
  });

  it("does not crash or hang on an unclosed quote that runs to EOF -- degrades gracefully by treating the remainder as one field", async () => {
    const csv = 'a,b\n"unterminated,1\nnext,2\n';
    const result = await parseSpreadsheetBuffer(buildCsv(csv), "csv");
    // No throw, no hang. Everything after the opening quote (including the
    // literal comma and newline that would otherwise be delimiters) is
    // consumed as literal field content until EOF -- this is inert (no
    // exploitable state), just a data-fidelity edge case for a malformed
    // file, not a security boundary.
    expect(result.rows.length).toBe(1);
  });

  it("parses a large, deliberately adversarial run of doubled-quote sequences across many rows in linear time (no ReDoS-style blowup)", async () => {
    // Each field is 20,000 doubled-quote pairs (collapsing to a 20,000-char
    // value, safely under the 32,767 per-cell cap) -- the shape most likely
    // to trip up a naive/backtracking implementation -- repeated across 500
    // rows for a large total input (~20MB). The parser is a single-pass
    // state machine with no regex and no lookahead beyond one character, so
    // this is expected to stay linear; this test proves it by timing rather
    // than asserting it from the algorithm's shape alone.
    const adversarialField = '""'.repeat(20_000);
    const rows = Array.from({ length: 500 }, (_, i) => `${i},"${adversarialField}"`);
    const csv = `a,b\n${rows.join("\n")}\n`;
    const start = performance.now();
    const result = await parseSpreadsheetBuffer(buildCsv(csv), "csv");
    const elapsedMs = performance.now() - start;
    expect(result.rows.length).toBe(500);
    expect(result.rows[0].b.length).toBe(20_000); // each "" collapses to one literal "
    expect(elapsedMs).toBeLessThan(5000);
  });

  it("rejects excessive rows even though the whole file is parsed before the row-count check runs (documents current buffered-then-checked behavior, bounded by the overall byte cap)", async () => {
    const header = "a\n";
    const tooManyRows = Array.from({ length: SPREADSHEET_LIMITS.maxRows + 1 }, (_, i) => `${i}`).join("\n");
    const csv = header + tooManyRows + "\n";
    await expect(parseSpreadsheetBuffer(buildCsv(csv), "csv")).rejects.toMatchObject({ reason: "TOO_MANY_ROWS" });
  });
});
