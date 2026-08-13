import { describe, expect, it } from "vitest";
import { toWinAnsiSafe } from "@/lib/pdf-text";

describe("toWinAnsiSafe", () => {
  it("replaces the symbols our PDFs actually use", () => {
    expect(toWinAnsiSafe("2026-2027 → 2027-2028")).toBe("2026-2027 -> 2027-2028");
    expect(toWinAnsiSafe("✓ done ⚠ missing • item")).toBe("[x] done (!) missing - item");
  });

  it("keeps WinAnsi-encodable text untouched, including cp1252 punctuation", () => {
    const text = 'Résumé — “quoted” naïve café';
    expect(toWinAnsiSafe(text)).toBe('Résumé — "quoted" naïve café');
  });

  it("degrades unknown characters to ? instead of letting drawText throw", () => {
    // 🎉 is a single code point (one ?), 汉字 is two.
    expect(toWinAnsiSafe("emoji 🎉 and 汉字")).toBe("emoji ? and ??");
  });
});
