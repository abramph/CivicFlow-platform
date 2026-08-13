/**
 * pdf-lib's standard fonts encode WinAnsi (cp1252) only — any character
 * outside it (→, ✓, ⚠, emoji, most non-Latin scripts) makes drawText THROW,
 * which turned the whole PTA-F transition packet into a 500 in production
 * (its subtitle contained "2026-2027 → 2027-2028"). Every string drawn with
 * a standard font must pass through here first — including user-entered
 * content like titles and notes, which can contain anything.
 */

const REPLACEMENTS: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "↔": "<->",
  "✓": "[x]",
  "✔": "[x]",
  "⚠": "(!)",
  "•": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-", // en dash — cp1252 has it, but normalize anyway for safety
  "…": "...",
};

/** cp1252-printable check: ASCII printable + the Latin-1/cp1252 upper range
 * that WinAnsiEncoding actually maps. */
function isWinAnsiSafe(char: string): boolean {
  const code = char.charCodeAt(0);
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  // cp1252 0x80-0x9F block members pdf-lib supports (em dash, curly quotes,
  // dagger, euro, etc.) — after REPLACEMENTS these are the common survivors.
  return "€‚ƒ„†‡ˆ‰Š‹ŒŽ—˜™š›œžŸ".includes(char);
}

export function toWinAnsiSafe(text: string): string {
  let out = "";
  for (const char of text) {
    const replaced = REPLACEMENTS[char];
    if (replaced !== undefined) {
      out += replaced;
    } else if (isWinAnsiSafe(char)) {
      out += char;
    } else {
      out += "?";
    }
  }
  return out;
}
