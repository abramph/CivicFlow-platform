import { describe, expect, it } from "vitest";
import { canEditFinancialRecord, canVoidFinancialRecord } from "@/lib/financial-edit-policy";

/**
 * fix/pta-treasurer-financial-controls §6 — resolving the financial-lock
 * policy. Decision (documented in docs/pta-treasurer-financial-controls.md):
 * the time-window model (createdAt + OrgSettings.financialEditWindowHours)
 * IS the coherent, already-working primary mechanism — nothing here was
 * actually dead. `lockedAt` is kept as a reserved manual/system-lock
 * override signal: nothing in this program adds UI to set it, but the
 * policy function must still handle it correctly if something ever does.
 * These tests pin the boundary behavior and the retained lock branch.
 */

const policy = {
  editWindowHours: 24,
  requireReasonForFinancialEdits: true,
  allowFinanceCorrections: true,
  lockReceiptsAfterIssue: true,
};

const anchor = new Date("2026-08-20T12:00:00.000Z");

describe("canEditFinancialRecord — time-window boundaries", () => {
  it("just before the window closes: editable by anyone, no reason needed", () => {
    const result = canEditFinancialRecord({
      record: { createdAt: new Date("2026-08-19T12:00:00.001Z") },
      role: "STAFF",
      policy,
      now: anchor,
    });
    expect(result.allowed).toBe(true);
  });

  it("at the exact expiration instant: still within the window (inclusive boundary)", () => {
    const result = canEditFinancialRecord({
      record: { createdAt: new Date("2026-08-19T12:00:00.000Z") },
      role: "STAFF",
      policy,
      now: anchor,
    });
    expect(result.allowed).toBe(true);
  });

  it("one millisecond after expiration: a non-privileged role is denied", () => {
    const result = canEditFinancialRecord({
      record: { createdAt: new Date("2026-08-19T11:59:59.999Z") },
      role: "STAFF",
      policy,
      now: anchor,
    });
    expect(result.allowed).toBe(false);
  });

  it("after expiration, a privileged role may still correct — with a reason", () => {
    const withoutReason = canEditFinancialRecord({
      record: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
      role: "FINANCE",
      policy,
      now: anchor,
    });
    expect(withoutReason.allowed).toBe(false);

    const withReason = canEditFinancialRecord({
      record: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
      role: "FINANCE",
      policy,
      now: anchor,
      editReason: "Correcting a transposed digit per treasurer's request",
    });
    expect(withReason.allowed).toBe(true);
  });

  it("privileged correction is refused outright when the org has disabled finance corrections", () => {
    const result = canEditFinancialRecord({
      record: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
      role: "FINANCE",
      policy: { ...policy, allowFinanceCorrections: false },
      now: anchor,
      editReason: "Fixing a typo",
    });
    expect(result.allowed).toBe(false);
  });

  it("a manually locked record (lockedAt set) is denied even inside the edit window — the reserved override still works", () => {
    const result = canEditFinancialRecord({
      record: { createdAt: anchor, lockedAt: anchor },
      role: "STAFF",
      policy,
      now: anchor,
    });
    expect(result.allowed).toBe(false);
  });

  it("a manually locked record still permits a privileged, reasoned correction", () => {
    const result = canEditFinancialRecord({
      record: { createdAt: anchor, lockedAt: anchor },
      role: "ORG_ADMIN",
      policy,
      now: anchor,
      editReason: "Manual lock override, approved by the board",
    });
    expect(result.allowed).toBe(true);
  });

  it("a voided record can never be edited, regardless of role, window, or lock", () => {
    const result = canEditFinancialRecord({
      record: { createdAt: anchor, voidedAt: anchor },
      role: "SUPER_ADMIN",
      policy,
      now: anchor,
      editReason: "Any reason at all",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/voided/i);
  });
});

describe("canVoidFinancialRecord — role gate", () => {
  it("privileged finance roles may void", () => {
    for (const role of ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE"] as const) {
      expect(canVoidFinancialRecord(role)).toBe(true);
    }
  });

  it("STAFF, READ_ONLY, and MEMBER may not void", () => {
    for (const role of ["STAFF", "READ_ONLY", "MEMBER"] as const) {
      expect(canVoidFinancialRecord(role)).toBe(false);
    }
  });
});
