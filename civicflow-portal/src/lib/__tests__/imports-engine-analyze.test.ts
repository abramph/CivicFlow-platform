import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Security Patch A -- analyzeBatch() previously had no try/catch around
 * spreadsheet parsing at all; a rejected file (now a normal, expected
 * outcome under the hardened parser, not just a rare edge case) would
 * throw straight out of analyzeBatch(), leaving the batch stuck in
 * ANALYZING forever. These tests prove the new behavior: a rejected file
 * transitions the batch to FAILED cleanly, using the real
 * parseSpreadsheetBuffer (not mocked) against real CSV content.
 */

const findFirstImportBatch = vi.fn();
const updateManyImportBatch = vi.fn().mockResolvedValue({ count: 1 });
vi.mock("@/lib/prisma", () => ({
  prisma: {
    importBatch: {
      findFirst: (...args: unknown[]) => findFirstImportBatch(...args),
      updateMany: (...args: unknown[]) => updateManyImportBatch(...args),
    },
    importRow: { create: vi.fn() },
    orgMember: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

const transitionImportBatch = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/imports/batch-state-machine", () => ({
  transitionImportBatch: (...args: unknown[]) => transitionImportBatch(...args),
}));

const getImportSourceFile = vi.fn();
vi.mock("@/lib/imports/storage", () => ({
  getImportSourceFile: (...args: unknown[]) => getImportSourceFile(...args),
}));

import { analyzeBatch } from "@/lib/imports/engine";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("analyzeBatch -- clean failure on a rejected file (Security Patch A)", () => {
  it("transitions the batch to FAILED (not stuck in ANALYZING) when the stored file fails hardened validation", async () => {
    findFirstImportBatch.mockResolvedValue({
      id: "batch-1",
      organizationId: "org-a",
      status: "UPLOADED",
      storageObjectKey: "organizations/org-a/imports/batch-1/source/x.csv",
      fileName: "members.xlsx", // claims .xlsx
      columnMapping: {},
      importKind: "COMMUNITY_MEMBERS",
    });
    // Real CSV bytes stored under a .xlsx claimed name/extension -- a
    // format-mismatch rejection, exercised through the real parser.
    getImportSourceFile.mockResolvedValue(Buffer.from("First Name,Last Name\nJane,Doe\n", "utf-8"));

    await analyzeBatch("batch-1", "org-a");

    const statuses = transitionImportBatch.mock.calls.map((call) => call[0].to);
    expect(statuses).toEqual(["ANALYZING", "FAILED"]);
  });

  it("transitions the batch to FAILED for a __proto__ header, without ever creating an ImportRow", async () => {
    const { prisma } = await import("@/lib/prisma");
    findFirstImportBatch.mockResolvedValue({
      id: "batch-2",
      organizationId: "org-a",
      status: "UPLOADED",
      storageObjectKey: "organizations/org-a/imports/batch-2/source/x.csv",
      fileName: "members.csv",
      columnMapping: {},
      importKind: "COMMUNITY_MEMBERS",
    });
    getImportSourceFile.mockResolvedValue(Buffer.from("__proto__,Last Name\nx,Doe\n", "utf-8"));

    await analyzeBatch("batch-2", "org-a");

    expect(transitionImportBatch.mock.calls.map((call) => call[0].to)).toEqual(["ANALYZING", "FAILED"]);
    expect(prisma.importRow.create).not.toHaveBeenCalled();
  });

  it("still analyzes normally end-to-end for a valid file (no regression from the new try/catch)", async () => {
    const { prisma } = await import("@/lib/prisma");
    findFirstImportBatch.mockResolvedValue({
      id: "batch-3",
      organizationId: "org-a",
      status: "UPLOADED",
      storageObjectKey: "organizations/org-a/imports/batch-3/source/x.csv",
      fileName: "members.csv",
      columnMapping: { "First Name": "firstName", "Last Name": "lastName" },
      importKind: "COMMUNITY_MEMBERS",
    });
    getImportSourceFile.mockResolvedValue(Buffer.from("First Name,Last Name\nJane,Doe\n", "utf-8"));
    vi.mocked(prisma.importRow.create).mockResolvedValue({} as never);

    await analyzeBatch("batch-3", "org-a");

    const statuses = transitionImportBatch.mock.calls.map((call) => call[0].to);
    expect(statuses).toEqual(["ANALYZING", "READY_FOR_REVIEW"]);
    expect(prisma.importRow.create).toHaveBeenCalledTimes(1);
  });
});
