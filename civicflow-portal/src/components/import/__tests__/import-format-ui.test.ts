import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Auth-ordering follow-up (Phase 4: format UI) -- this codebase has no
 * React-rendering test setup (no @testing-library/react, no jsdom, no
 * existing .test.tsx files anywhere in the repo), so these are source-level
 * assertions rather than rendered-DOM assertions: they read each file's raw
 * text and check the exact `accept` attribute contents and guidance
 * copy, matching the "UI/source tests" framing of the original request
 * without introducing a new test dependency out of scope for a local-only
 * follow-up.
 */

function readNormalized(path: string): string {
  // JSX text nodes wrap across multiple source lines (collapsing to single
  // spaces only once rendered) -- normalize whitespace so a literal-string
  // check against the raw source doesn't fail on a line break the browser
  // would never actually show the user.
  return readFileSync(path, "utf-8").replace(/\s+/g, " ");
}

const IMPORT_PAGE_CLIENT = readNormalized(join(process.cwd(), "src/components/import/ImportPageClient.tsx"));
const IMPORT_UPLOAD_FORM = readNormalized(join(process.cwd(), "src/components/import/ImportUploadForm.tsx"));
const MIGRATION_PAGE = readNormalized(join(process.cwd(), "src/app/migration/page.tsx"));

/** Extracts every accept="..." attribute value in a source file, split into
 * its comma-separated extension tokens. Splitting on commas (rather than a
 * naive .includes(".xls") substring check) matters because the string
 * ".xlsx" itself contains ".xls" as a substring -- a naive check would
 * false-positive on the very extension we DO support. */
function acceptTokens(source: string): string[][] {
  const matches = [...source.matchAll(/accept="([^"]*)"/g)];
  return matches.map((m) => m[1].split(",").map((t) => t.trim().toLowerCase()));
}

describe("Import format UI -- .xls removal and conversion guidance (auth-ordering follow-up, Phase 4)", () => {
  it("ImportPageClient.tsx: the file input's accept attribute lists .xlsx and .csv but not legacy .xls", () => {
    const tokenLists = acceptTokens(IMPORT_PAGE_CLIENT);
    expect(tokenLists.length).toBeGreaterThan(0);
    for (const tokens of tokenLists) {
      expect(tokens).toContain(".xlsx");
      expect(tokens).toContain(".csv");
      expect(tokens).not.toContain(".xls");
    }
  });

  it("ImportPageClient.tsx: renders visible legacy-.xls conversion guidance associated with the input via aria-describedby", () => {
    expect(IMPORT_PAGE_CLIENT).toMatch(/Legacy \.xls files are no longer supported\. Open the file and save it as \.xlsx or \.csv before uploading\./);
    expect(IMPORT_PAGE_CLIENT).toMatch(/id="import-format-help"/);
    expect(IMPORT_PAGE_CLIENT).toMatch(/aria-describedby="import-format-help"/);
  });

  it("ImportPageClient.tsx: the error region uses role=\"alert\" and does not rely on color alone", () => {
    expect(IMPORT_PAGE_CLIENT).toMatch(/role="alert"/);
    expect(IMPORT_PAGE_CLIENT).toMatch(/Error: /);
  });

  it("ImportUploadForm.tsx: the file input's accept attribute lists .xlsx and .csv but not legacy .xls", () => {
    const tokenLists = acceptTokens(IMPORT_UPLOAD_FORM);
    expect(tokenLists.length).toBeGreaterThan(0);
    for (const tokens of tokenLists) {
      expect(tokens).toContain(".xlsx");
      expect(tokens).toContain(".csv");
      expect(tokens).not.toContain(".xls");
    }
  });

  it("ImportUploadForm.tsx: renders visible legacy-.xls conversion guidance associated with the input via aria-describedby", () => {
    expect(IMPORT_UPLOAD_FORM).toMatch(/Legacy \.xls files are no longer supported\. Open the file and save it as \.xlsx or \.csv before uploading\./);
    expect(IMPORT_UPLOAD_FORM).toMatch(/id="import-upload-format-help"/);
    expect(IMPORT_UPLOAD_FORM).toMatch(/aria-describedby="import-upload-format-help"/);
  });

  it("ImportUploadForm.tsx: both error regions (upload step and map step) use role=\"alert\" and do not rely on color alone", () => {
    const alertMatches = IMPORT_UPLOAD_FORM.match(/role="alert"/g) ?? [];
    expect(alertMatches.length).toBeGreaterThanOrEqual(2);
    const errorPrefixMatches = IMPORT_UPLOAD_FORM.match(/Error: /g) ?? [];
    expect(errorPrefixMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("migration/page.tsx: the file input's accept attribute lists .xlsx and .csv but not legacy .xls", () => {
    const tokenLists = acceptTokens(MIGRATION_PAGE);
    expect(tokenLists.length).toBeGreaterThan(0);
    for (const tokens of tokenLists) {
      expect(tokens).toContain(".xlsx");
      expect(tokens).toContain(".csv");
      expect(tokens).not.toContain(".xls");
    }
  });

  it("migration/page.tsx: renders visible legacy-.xls conversion guidance associated with the input via aria-describedby, and the format table itself is updated", () => {
    expect(MIGRATION_PAGE).toMatch(/Legacy \.xls files are no longer supported\. Open the file and save it as \.xlsx or \.csv before uploading\./);
    expect(MIGRATION_PAGE).toMatch(/id="migration-format-help"/);
    expect(MIGRATION_PAGE).toMatch(/aria-describedby="migration-format-help"/);
    // FORMAT_INFO's spreadsheet row: label the extension column .csv / .xlsx,
    // not the old .csv / .xlsx / .xls.
    expect(MIGRATION_PAGE).toMatch(/ext:\s*".csv \/ .xlsx"/);
    expect(MIGRATION_PAGE).not.toMatch(/ext:\s*".csv \/ .xlsx \/ .xls"/);
  });

  it("migration/page.tsx: the result-error region uses role=\"alert\" and does not rely on color alone", () => {
    expect(MIGRATION_PAGE).toMatch(/role="alert"/);
    expect(MIGRATION_PAGE).toMatch(/Error: /);
  });

  it("all three surfaces use identical conversion-guidance wording (generic and migration import screens stay consistent)", () => {
    const GUIDANCE = "Legacy .xls files are no longer supported. Open the file and save it as .xlsx or .csv before uploading.";
    expect(IMPORT_PAGE_CLIENT).toContain(GUIDANCE);
    expect(IMPORT_UPLOAD_FORM).toContain(GUIDANCE);
    expect(MIGRATION_PAGE).toContain(GUIDANCE);
  });
});
