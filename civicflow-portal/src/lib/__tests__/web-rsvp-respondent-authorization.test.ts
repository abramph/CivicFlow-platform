import { describe, expect, it } from "vitest";

import { canDo, PERMISSIONS } from "@/lib/rbac";

/**
 * Build 27 round-1 follow-up — regression pins for the web respondent-list
 * authorization review. The respondent tables on /events/[id] and
 * /meetings/[id] (and the PTA labs officer page, behind its own PTA gate)
 * sit behind requirePermission("events:read") / requirePermission("meetings:read").
 * These tests pin the two facts that make that safe:
 *
 * 1. The MEMBER role holds NO staff permissions at all, so an ordinary
 *    member login can never pass either page gate — respondent identities
 *    are unreachable for them server-side, not merely hidden. (PTA parents
 *    hold no OrganizationMembership row at all, so requirePermission fails
 *    for them even earlier — there is no role to check.)
 * 2. Staff read roles (READ_ONLY and up) DO hold the reads — deliberate,
 *    documented product policy: the same roles already read the members
 *    list, attendance records, and audit logs, so respondent names are not
 *    an escalation for them. If this ever changes, these assertions force
 *    the change to be explicit.
 */
describe("web respondent-list authorization (events:read / meetings:read)", () => {
  it("MEMBER-role logins can never reach the respondent pages -- neither read permission is held", () => {
    expect(canDo("MEMBER", PERMISSIONS.EVENTS_READ)).toBe(false);
    expect(canDo("MEMBER", PERMISSIONS.MEETINGS_READ)).toBe(false);
    expect(canDo("MEMBER", PERMISSIONS.EVENTS_WRITE)).toBe(false);
    expect(canDo("MEMBER", PERMISSIONS.MEETINGS_WRITE)).toBe(false);
  });

  it("staff read roles hold the page gates (existing staff-read policy, pinned deliberately)", () => {
    expect(canDo("READ_ONLY", PERMISSIONS.EVENTS_READ)).toBe(true);
    expect(canDo("READ_ONLY", PERMISSIONS.MEETINGS_READ)).toBe(true);
    // ...but never the write/administrative authority.
    expect(canDo("READ_ONLY", PERMISSIONS.EVENTS_WRITE)).toBe(false);
    expect(canDo("READ_ONLY", PERMISSIONS.MEETINGS_WRITE)).toBe(false);
  });
});
