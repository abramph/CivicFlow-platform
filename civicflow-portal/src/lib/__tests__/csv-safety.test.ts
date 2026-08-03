import { describe, expect, it } from "vitest";
import { csvCell, csvRow, sanitizeFormulaCell } from "@/lib/csv-safety";

describe("sanitizeFormulaCell — CSV/Excel formula-injection protection", () => {
  it.each([
    ["=cmd|'/c calc'!A1", "'=cmd|'/c calc'!A1"],
    ["+1+1", "'+1+1"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1:A10)", "'@SUM(A1:A10)"],
    ["\tsneaky", "'\tsneaky"],
    ["\rsneaky", "'\rsneaky"],
  ])("prefixes a leading formula-trigger character: %s", (input, expected) => {
    expect(sanitizeFormulaCell(input)).toBe(expected);
  });

  it("leaves ordinary text untouched", () => {
    expect(sanitizeFormulaCell("Jane Smith")).toBe("Jane Smith");
    expect(sanitizeFormulaCell("123 Main St")).toBe("123 Main St");
  });

  it("does not double-prefix a value that's already apostrophe-escaped", () => {
    const once = sanitizeFormulaCell("=1+1");
    expect(sanitizeFormulaCell(once)).toBe(once);
  });

  it("treats null/undefined as an empty string", () => {
    expect(sanitizeFormulaCell(null)).toBe("");
    expect(sanitizeFormulaCell(undefined)).toBe("");
  });
});

describe("csvCell — sanitization + CSV quoting", () => {
  it("quotes a value containing a comma after sanitizing", () => {
    expect(csvCell("Smith, Jane")).toBe('"Smith, Jane"');
  });

  it("sanitizes AND quotes when a formula-trigger value also needs quoting", () => {
    expect(csvCell("=A1,B1")).toBe(`"'=A1,B1"`);
  });

  it("escapes embedded double quotes", () => {
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""');
  });
});

describe("csvRow", () => {
  it("joins sanitized/quoted cells with commas", () => {
    expect(csvRow(["Jane", "=evil()", "Smith, Jr."])).toBe(`Jane,'=evil(),"Smith, Jr."`);
  });
});
