import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstContact = vi.fn();
const findManyContacts = vi.fn();
const createContactRow = vi.fn();
const updateContactRow = vi.fn();
const findManyExpenditures = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationContact: {
      findFirst: (...a: unknown[]) => findFirstContact(...a),
      findMany: (...a: unknown[]) => findManyContacts(...a),
      create: (...a: unknown[]) => createContactRow(...a),
      update: (...a: unknown[]) => updateContactRow(...a),
    },
    expenditure: { findMany: (...a: unknown[]) => findManyExpenditures(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import { createContact, getVendorHistory } from "@/lib/contacts";

const actor = { actorUserId: "u1", actorEmail: "officer@example.org" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createContact", () => {
  it("requires a name and rejects out-of-range ratings", async () => {
    await expect(createContact({ organizationId: "org-1", name: "  ", ...actor })).rejects.toMatchObject({ name: "FinanceError" });
    await expect(createContact({ organizationId: "org-1", name: "Vendor", rating: 6, ...actor })).rejects.toMatchObject({ name: "FinanceError" });
  });

  it("duplicate names in the same org 409", async () => {
    findFirstContact.mockResolvedValueOnce({ id: "existing" });
    await expect(createContact({ organizationId: "org-1", name: "Main Street Printing", ...actor })).rejects.toMatchObject({ status: 409 });
  });
});

describe("getVendorHistory (§24: computed, never entered)", () => {
  it("matches non-void expenditures by name case-insensitively and aggregates spend + events", async () => {
    findFirstContact.mockResolvedValueOnce({ id: "v1", name: "Main Street Printing", isVendor: true });
    findManyExpenditures.mockResolvedValueOnce([
      { id: "e1", date: new Date("2026-05-01"), amount: 120.5, description: "Yearbook printing", event: { id: "ev1", title: "Yearbook" } },
      { id: "e2", date: new Date("2026-03-01"), amount: 80, description: "Flyers", event: null },
      { id: "e3", date: new Date("2026-02-01"), amount: 99.5, description: "Banners", event: { id: "ev1", title: "Yearbook" } },
    ]);

    const history = await getVendorHistory("org-1", "v1");

    const where = findManyExpenditures.mock.calls[0][0].where;
    expect(where.voidedAt).toBeNull();
    expect(where.vendor).toEqual({ equals: "Main Street Printing", mode: "insensitive" });

    expect(history.totalSpend).toBe(300);
    expect(history.expenditureCount).toBe(3);
    expect(history.events).toEqual(["Yearbook"]);
  });

  it("cross-organization contacts are invisible", async () => {
    findFirstContact.mockResolvedValueOnce(null);
    await expect(getVendorHistory("org-1", "foreign")).rejects.toMatchObject({ status: 404 });
  });
});
