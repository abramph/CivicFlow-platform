import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultPaymentMethods } from "@/lib/payment-methods";

/**
 * PAYROLL_CHECKOFF is an employer-remitted bulk payment type — never
 * member-initiated — and must only be reachable through the administrative
 * bulk payment-import/reconciliation workflow. This is a permanent
 * regression guard (not a one-time manual check) against it ever leaking
 * into a member-facing or manual single-payment surface.
 */

const ROOT = path.resolve(__dirname, "../..");
function source(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf-8");
}

describe("PAYROLL_CHECKOFF stays confined to the bulk import/reconciliation workflow", () => {
  it("is absent from the org's configurable, member-payable payment-method list", () => {
    expect(defaultPaymentMethods.some((m) => m.method === "PAYROLL_CHECKOFF")).toBe(false);
  });

  it.each([
    ["app/api/settings/payment-methods/route.ts", "org-level payment-method config API"],
    ["components/forms/PaymentMethodsManager.tsx", "org-level payment-method config UI"],
    ["components/app/PayableMethodsList.tsx", "member-facing payable-methods list"],
    ["components/forms/ContributionCreateForm.tsx", "member/officer contribution form"],
    ["components/forms/ContributionEditForm.tsx", "contribution edit form"],
    ["components/labs/pta/RecordDuesPaymentForm.tsx", "officer manual single dues-payment form"],
    ["components/forms/MemberReportPaymentForm.tsx", "member self-reported payment form"],
    ["components/labs/pta/PtaReportPaymentForm.tsx", "PTA parent self-reported payment form"],
    ["app/api/dues/payments/route.ts", "manual single dues-payment API"],
  ])("never appears in %s (%s)", (relativePath) => {
    expect(source(relativePath)).not.toContain("PAYROLL_CHECKOFF");
  });

  it("IS present in the approved bulk-import surfaces (sanity check that the guard above is actually meaningful)", () => {
    expect(source("components/forms/PaymentImportCreateForm.tsx")).toContain("PAYROLL_CHECKOFF");
    expect(source("app/api/payments/imports/route.ts")).toContain("PAYROLL_CHECKOFF");
    expect(source("lib/payment-reconciliation.ts")).toContain("PAYROLL_CHECKOFF");
  });
});
