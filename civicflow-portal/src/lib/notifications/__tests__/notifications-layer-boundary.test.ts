import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Architectural regression guard: the low-level push transport (`@/lib/push`,
 * which sets titles verbatim and has no org-identity resolution) must be
 * imported by exactly ONE production module — the canonical notification layer
 * `src/lib/notifications/send.ts`. Every organization-generated push therefore
 * goes through the server-authoritative identity formatter (org name as title,
 * Unestra as the app), and reserved payload fields are written by push.ts and
 * never overridden. A new feature that reaches for `sendPushToTokens` /
 * `sendPushToMember` directly will fail this test.
 *
 * Test files are exempt (push.test.ts legitimately tests the transport in
 * isolation).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(here, "../../..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const PUSH_IMPORT_RE = /from\s+["']@\/lib\/push["']/;

describe("notification layer boundary", () => {
  it("only the canonical notifications/send.ts imports the low-level @/lib/push transport", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
      if (rel.includes("__tests__") || rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;
      if (PUSH_IMPORT_RE.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
    expect(offenders.sort()).toEqual(["lib/notifications/send.ts"]);
  });
});
