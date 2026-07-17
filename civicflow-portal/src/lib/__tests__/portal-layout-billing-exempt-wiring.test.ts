import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * PortalLayout (src/app/(portal)/layout.tsx) is a Next.js Server Component
 * with no render harness in this repo's test suite (see the equivalent
 * platform-operations-authorization-wiring.test.ts rationale). This is a
 * source-level regression guard: the trial-expiration wall's condition must
 * always consult Organization.billingExempt, so a future edit can't
 * reintroduce the bug where the internal platform-owning organization gets
 * shown "Your free trial has ended."
 */
describe("PortalLayout trial-expiration gate respects billingExempt", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../../app/(portal)/layout.tsx"),
    "utf8"
  );

  it("selects billingExempt from the database alongside plan/trialEndsAt", () => {
    // [^}]/[^;] character classes already span newlines without needing the
    // `s` (dotAll) flag, which requires an ES2018+ compile target — this repo
    // targets ES2017.
    expect(source).toMatch(/select:\s*\{[^}]*billingExempt:\s*true[^}]*\}/);
  });

  it("the trialExpired condition checks billingExempt before plan/trialEndsAt", () => {
    const match = source.match(/const trialExpired\s*=\s*([^;]+);/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/billingExempt/);
  });

  it("does not gate on plan/trialEndsAt without also referencing billingExempt in the same expression", () => {
    const match = source.match(/const trialExpired\s*=\s*([^;]+);/);
    const expression = match![1];
    expect(expression).toContain("org?.plan");
    expect(expression).toContain("billingExempt");
  });
});
