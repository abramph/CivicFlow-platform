import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * This repo's existing test suite is entirely API-route/lib-level — there is
 * no React Server Component rendering harness set up anywhere (no React
 * Testing Library, no next/server test renderer). Rather than stand up new
 * test infrastructure just for this feature, this is a source-level
 * regression guard: every page (and the shared layout) under
 * src/app/admin/platform must import and call requireSuperAdmin() as its
 * authorization gate. It fails loudly if a future edit removes the check
 * from any current or newly-added page, without needing to actually render
 * a Server Component tree.
 *
 * The real behavioral proof that requireSuperAdmin()/requirePlatformRole()
 * correctly enforce PlatformAccess independent of active organization,
 * reject ORG_OWNER/ORG_ADMIN, reject unauthenticated requests, and never
 * leak into tenant-scoped guards already lives in
 * auth-guards-platform.test.ts and platform-tenant-isolation.test.ts —
 * every page below calls that exact same, already-tested function.
 */

function walk(dir: string, matches: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, matches);
    } else if (entry === "page.tsx" || entry === "layout.tsx") {
      matches.push(full);
    }
  }
  return matches;
}

function findPlatformOperationsSourceFiles(): string[] {
  const root = path.resolve(__dirname, "../../app/admin/platform");
  return walk(root, []);
}

describe("Operations Center pages require global platform authorization", () => {
  const files = findPlatformOperationsSourceFiles();

  it("finds at least the expected set of Operations Center route files", () => {
    // Sanity check that the walk itself is working, not just returning [].
    expect(files.length).toBeGreaterThanOrEqual(9); // layout + 8 pages, SMS submodule not counted here
  });

  it.each(findPlatformOperationsSourceFiles())("%s imports requireSuperAdmin from auth-guards", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(/import\s+\{[^}]*requireSuperAdmin[^}]*\}\s+from\s+["']@\/lib\/auth-guards["']/);
  });

  it.each(findPlatformOperationsSourceFiles())("%s actually calls requireSuperAdmin(), not just imports it", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(/await\s+requireSuperAdmin\s*\(/);
  });

  it.each(findPlatformOperationsSourceFiles())("%s never uses a weaker/legacy guard as a substitute", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/requireRole\(\s*["']SUPER_ADMIN["']/);
    expect(source).not.toMatch(/session\.role\s*===\s*["']SUPER_ADMIN["']/);
    expect(source).not.toMatch(/cf_active_org/);
  });
});
