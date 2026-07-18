import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Labs access resolver is fully decoupled from platform authorization", () => {
  it("access.ts has zero import statements referencing PlatformAccess/auth-guards — PlatformAccess cannot grant or influence tenant Labs access", () => {
    const source = readFileSync(path.resolve(__dirname, "../access.ts"), "utf8");
    const importLines = source.split("\n").filter((line) => line.trim().startsWith("import "));
    for (const line of importLines) {
      expect(line).not.toMatch(/platform-access|auth-guards/);
    }
    expect(source).not.toMatch(/requireSuperAdmin\s*\(|requirePlatformRole\s*\(|prisma\.platformAccess/);
  });

  it("registry.ts has zero import statements referencing PlatformAccess/auth-guards", () => {
    const source = readFileSync(path.resolve(__dirname, "../registry.ts"), "utf8");
    const importLines = source.split("\n").filter((line) => line.trim().startsWith("import "));
    expect(importLines).toHaveLength(0);
  });
});
