import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * PortalLayout (src/app/(portal)/layout.tsx) is a Next.js Server Component
 * with no render harness in this repo's test suite (see the equivalent
 * platform-operations-authorization-wiring.test.ts rationale). This is a
 * source-level regression guard for the LAUNCH-BLOCKER subscription gate:
 * dashboard/analytics/payments (this route group) read the session directly
 * rather than calling requireOrganization()/requirePermission(), so this
 * layout is their only enforcement point — it must always delegate to the
 * canonical resolveOrganizationAccess() (which already has its own direct
 * unit coverage for billingExempt/trialEndsAt/subscriptionStatus in
 * subscription-gate.test.ts) rather than hand-rolling an independent
 * trial/billing comparison that could drift from every other enforcement
 * chokepoint.
 */
describe("PortalLayout delegates to the canonical subscription gate", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../../app/(portal)/layout.tsx"),
    "utf8"
  );

  it("imports resolveOrganizationAccess from the canonical subscription-gate module", () => {
    expect(source).toMatch(/import\s*\{\s*resolveOrganizationAccess\s*\}\s*from\s*"@\/lib\/subscription-gate"/);
  });

  it("calls resolveOrganizationAccess and redirects to /subscription-required when denied", () => {
    expect(source).toMatch(/resolveOrganizationAccess\(organizationId\)/);
    expect(source).toMatch(/redirect\("\/subscription-required"\)/);
  });

  it("does not hand-roll an independent billingExempt/trialEndsAt/plan comparison", () => {
    // The old ad-hoc `const trialExpired = ... billingExempt ... plan ...`
    // expression must be gone — any trial/billing comparison belongs solely
    // in subscription-gate.ts.
    expect(source).not.toMatch(/const trialExpired\s*=/);
  });

  it("still exempts the billing settings page from the gate (recovery-path allowlist)", () => {
    expect(source).toMatch(/isBillingPage/);
    expect(source).toMatch(/\/settings\/billing/);
  });
});
