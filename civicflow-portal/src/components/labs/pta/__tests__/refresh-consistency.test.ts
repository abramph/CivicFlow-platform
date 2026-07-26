import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression guard for a stale-post-action-UI class of bug: every PTA client
 * component that performs a mutating request (POST/PATCH/DELETE) must call
 * `router.refresh()` after a successful response, so the officer/parent sees
 * updated capacity counts, statuses, and totals without a manual reload.
 *
 * This is a static-source check rather than a rendered-DOM test because this
 * repo's Vitest setup is Node-only (no jsdom/React Testing Library) — see
 * vitest.config.ts. A live browser walkthrough (documented in
 * docs/pta-volunteer-management.md) already confirmed the actual rendered
 * behavior updates correctly with no manual reload; this test exists so a
 * future change that silently drops a `router.refresh()` call fails CI
 * instead of only being caught by manual testing.
 */

const COMPONENTS_DIR = path.resolve(__dirname, "..");

function listComponentFiles(): string[] {
  return fs
    .readdirSync(COMPONENTS_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => path.join(COMPONENTS_DIR, f));
}

function readSource(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

/** A component "mutates" if it sends a POST/PATCH/DELETE via fetch — a plain
 * GET-only fetch (e.g. a search/lookup helper) is exempt. */
function countMutatingFetches(source: string): number {
  return (source.match(/method:\s*["'](POST|PATCH|DELETE)["']/g) ?? []).length;
}

function countRefreshCalls(source: string): number {
  return (source.match(/router\.refresh\(\)/g) ?? []).length;
}

describe("PTA client components refresh after a successful mutation", () => {
  const files = listComponentFiles();

  it("finds at least the known set of mutating PTA components (sanity check)", () => {
    const mutating = files.filter((f) => countMutatingFetches(readSource(f)) > 0);
    expect(mutating.length).toBeGreaterThanOrEqual(20);
  });

  for (const file of listComponentFiles()) {
    const name = path.basename(file);
    const source = readSource(file);
    const mutations = countMutatingFetches(source);
    if (mutations === 0) continue;

    // Counting (not just presence) so a component with N mutating actions —
    // e.g. HourEntryApprovalControls' separate approve() and reject() — must
    // refresh N times, not just once somewhere in the file. A file-level
    // existence check alone would miss exactly this: dropping the refresh
    // from one of two mutating handlers while leaving the other intact.
    it(`${name} calls router.refresh() after every one of its ${mutations} mutating action(s)`, () => {
      expect(source).toMatch(/useRouter/);
      expect(countRefreshCalls(source)).toBeGreaterThanOrEqual(mutations);
    });

    it(`${name} guards its primary action against double-submission while pending`, () => {
      expect(source).toMatch(/disabled=\{[^}]*pending/);
    });
  }
});
