import { describe, expect, it } from "vitest";
import { sanitizeContentDispositionFilename } from "../storage";
import { buildDeterministicVolunteerReportObjectKey } from "../report-export-queue";

/**
 * fix/report-export-queue-hardening follow-up — deterministic-key and
 * Content-Disposition safety. The storage object KEY is built only from
 * organizationId and exportId, both server-generated opaque cuids that
 * never contain user-facing/attacker-influenceable text — so the "filename
 * injection" surface these tests cover is entirely about the SEPARATE
 * downloadFilename/Content-Disposition path, not the key itself. Every
 * test below proves that distinction holds.
 */

describe("buildDeterministicVolunteerReportObjectKey — immutable-IDs-only, never influenced by user-facing names", () => {
  it("is built only from organizationId and exportId — no filename/title component at all", () => {
    const key = buildDeterministicVolunteerReportObjectKey("cms88g6190000z1vor3vkpai4", "cmtd53fkh0001z16sa914cacs");
    expect(key).toBe("pta-volunteer-reports/cms88g6190000z1vor3vkpai4/cmtd53fkh0001z16sa914cacs.xlsx");
  });

  it("duplicate human-readable report names across different exports never collide — the key doesn't depend on the name at all", () => {
    // Two different exports that would produce identically-titled reports
    // ("Family Volunteer Summary") still get fully distinct keys, because
    // the key is derived from exportId, never from the report title.
    const keyA = buildDeterministicVolunteerReportObjectKey("org-1", "export-A");
    const keyB = buildDeterministicVolunteerReportObjectKey("org-1", "export-B");
    expect(keyA).not.toBe(keyB);
  });

  it("different organizations with similarly-named reports never collide", () => {
    const keyOrg1 = buildDeterministicVolunteerReportObjectKey("org-1", "export-1");
    const keyOrg2 = buildDeterministicVolunteerReportObjectKey("org-2", "export-1");
    expect(keyOrg1).not.toBe(keyOrg2);
  });

  it("a retry of the same export produces the identical key — this IS the idempotency guarantee, not a bug", () => {
    const first = buildDeterministicVolunteerReportObjectKey("org-1", "export-1");
    const second = buildDeterministicVolunteerReportObjectKey("org-1", "export-1");
    expect(first).toBe(second);
  });

  it("the key format has no path-traversal, CRLF, or unicode surface at all — it's a template string over two cuid-shaped inputs", () => {
    // Even a maximally hostile (impossible in practice, since these are
    // server-generated cuids, never user input) organizationId/exportId
    // would only ever be interpolated verbatim into the S3 key path — there
    // is no filename-sanitization step in this function because there is
    // no filename input to sanitize. This test documents that boundary
    // rather than attempting to "fix" something that isn't a free-text
    // field.
    const key = buildDeterministicVolunteerReportObjectKey("org-1", "export-1");
    expect(key.split("/")).toEqual(["pta-volunteer-reports", "org-1", "export-1.xlsx"]);
  });
});

describe("sanitizeContentDispositionFilename — the actual user-influenceable surface", () => {
  it("strips CRLF (HTTP header/response-splitting injection)", () => {
    const result = sanitizeContentDispositionFilename('report\r\nSet-Cookie: evil=1');
    expect(result).not.toContain("\r");
    expect(result).not.toContain("\n");
  });

  it("strips bare CR and bare LF individually, not only the \\r\\n pair", () => {
    expect(sanitizeContentDispositionFilename("a\rb")).not.toContain("\r");
    expect(sanitizeContentDispositionFilename("a\nb")).not.toContain("\n");
  });

  it("strips other C0 control characters", () => {
    const result = sanitizeContentDispositionFilename("report\x00\x07\x1bname");
    expect(result).toBe("reportname");
  });

  it("strips double-quote characters that would otherwise break out of the quoted filename value", () => {
    const result = sanitizeContentDispositionFilename('report" attachment; filename="evil');
    expect(result).not.toContain('"');
  });

  it("replaces path-traversal and slash characters with a safe separator (defensive — these were never part of the storage key, only ever the display name)", () => {
    const result = sanitizeContentDispositionFilename("../../../etc/passwd");
    expect(result).not.toContain("/");
    expect(result).not.toContain("\\");
  });

  it("preserves ordinary unicode characters (not a byte-for-byte ASCII filter — only control/quote characters are stripped)", () => {
    const result = sanitizeContentDispositionFilename("Rapport Financier été 2026");
    expect(result).toContain("été");
  });

  it("truncates extremely long filenames to a bounded length", () => {
    const result = sanitizeContentDispositionFilename("x".repeat(10_000));
    expect(result.length).toBeLessThanOrEqual(150);
  });

  it("falls back to a safe default for an empty or all-stripped input rather than producing an empty filename value", () => {
    expect(sanitizeContentDispositionFilename("")).toBe("download");
    expect(sanitizeContentDispositionFilename("\r\n\x00")).toBe("download");
  });

  it("leaves an already-safe, real report filename completely unchanged", () => {
    const safe = "Pine_Grove_School_PTA_Family_Volunteer_Summary_2026-2027_2026-08-29.xlsx";
    expect(sanitizeContentDispositionFilename(safe)).toBe(safe);
  });
});
