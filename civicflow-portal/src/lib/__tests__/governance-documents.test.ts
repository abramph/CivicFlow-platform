import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstDoc = vi.fn();
const findManyDocs = vi.fn();
const createDoc = vi.fn();
const txUpdateManyDocs = vi.fn();
const txUpdateDoc = vi.fn();
const transaction = vi.fn();
const uploadBufferToSpaces = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    governanceDocument: {
      findFirst: (...a: unknown[]) => findFirstDoc(...a),
      findMany: (...a: unknown[]) => findManyDocs(...a),
      create: (...a: unknown[]) => createDoc(...a),
    },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));
vi.mock("@/lib/storage", () => ({
  buildSafeObjectKey: (prefix: string, name: string) => `${prefix}/mock/${name}`,
  uploadBufferToSpaces: (...args: unknown[]) => uploadBufferToSpaces(...args),
  getSignedObjectUrl: vi.fn().mockResolvedValue("https://signed.example/url"),
}));

import { createGovernanceDocument, listGovernanceDocuments, setGovernanceDocumentStatus } from "@/lib/governance-documents";

function transactionRunsCallback() {
  transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      governanceDocument: {
        updateMany: (...a: unknown[]) => txUpdateManyDocs(...a),
        update: (...a: unknown[]) => txUpdateDoc(...a),
      },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createGovernanceDocument", () => {
  it("requires a title", async () => {
    await expect(
      createGovernanceDocument({ organizationId: "org-1", title: "  ", docType: "BYLAWS", actorUserId: "u1" })
    ).rejects.toMatchObject({ name: "GovernanceDocumentError" });
  });

  it("rejects amending a document from another organization", async () => {
    findFirstDoc.mockResolvedValueOnce(null);
    await expect(
      createGovernanceDocument({ organizationId: "org-1", title: "Bylaws", docType: "BYLAWS", rootDocumentId: "foreign", actorUserId: "u1" })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("a new version increments within the group and links the root", async () => {
    findFirstDoc
      .mockResolvedValueOnce({ id: "root-1", rootDocumentId: null }) // root lookup
      .mockResolvedValueOnce({ version: 3 }); // latest version in group
    createDoc.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "doc-4", ...args.data }));

    const document = await createGovernanceDocument({
      organizationId: "org-1",
      title: "Bylaws",
      docType: "BYLAWS",
      rootDocumentId: "root-1",
      actorUserId: "u1",
    });
    expect(document).toMatchObject({ version: 4, rootDocumentId: "root-1" });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "governance.document_version_added" }));
  });

  it("uploads the file through the storage layer with a safe key", async () => {
    createDoc.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "doc-1", ...args.data }));
    await createGovernanceDocument({
      organizationId: "org-1",
      title: "Bylaws",
      docType: "BYLAWS",
      file: { fileName: "bylaws.pdf", contentType: "application/pdf", buffer: Buffer.from("pdf") },
      actorUserId: "u1",
    });
    expect(uploadBufferToSpaces).toHaveBeenCalledWith(expect.objectContaining({ key: "governance/org-1/mock/bylaws.pdf" }));
  });
});

describe("setGovernanceDocumentStatus", () => {
  it("cross-organization access is denied", async () => {
    findFirstDoc.mockResolvedValueOnce(null);
    await expect(
      setGovernanceDocumentStatus({ organizationId: "org-1", documentId: "foreign", status: "CURRENT", actorUserId: "u1" })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("SUPERSEDED can never be set manually", async () => {
    findFirstDoc.mockResolvedValueOnce({ id: "doc-1", status: "CURRENT", rootDocumentId: null, title: "Bylaws" });
    await expect(
      setGovernanceDocumentStatus({ organizationId: "org-1", documentId: "doc-1", status: "SUPERSEDED", actorUserId: "u1" })
    ).rejects.toMatchObject({ name: "GovernanceDocumentError" });
  });

  it("publishing CURRENT supersedes only this group's previous current version", async () => {
    findFirstDoc.mockResolvedValueOnce({ id: "doc-4", status: "DRAFT", rootDocumentId: "root-1", title: "Bylaws" });
    txUpdateManyDocs.mockResolvedValueOnce({ count: 1 });
    txUpdateDoc.mockResolvedValueOnce({ id: "doc-4", status: "CURRENT" });
    transactionRunsCallback();

    await setGovernanceDocumentStatus({ organizationId: "org-1", documentId: "doc-4", status: "CURRENT", actorUserId: "u1" });

    const where = txUpdateManyDocs.mock.calls[0][0].where;
    expect(where.organizationId).toBe("org-1");
    expect(where.status).toBe("CURRENT");
    // Group-pinned: only versions sharing root-1's group, never other documents.
    expect(where.OR).toEqual([{ id: "root-1" }, { rootDocumentId: "root-1" }]);
    expect(txUpdateManyDocs.mock.calls[0][0].data).toEqual({ status: "SUPERSEDED" });
  });
});

describe("listGovernanceDocuments", () => {
  it("groups versions and surfaces the current one", async () => {
    findManyDocs.mockResolvedValueOnce([
      { id: "v2", rootDocumentId: "v1", docType: "BYLAWS", title: "Bylaws", version: 2, status: "CURRENT" },
      { id: "v1", rootDocumentId: null, docType: "BYLAWS", title: "Bylaws", version: 1, status: "SUPERSEDED" },
      { id: "p1", rootDocumentId: null, docType: "POLICY", title: "Refund Policy", version: 1, status: "DRAFT" },
    ]);
    const groups = await listGovernanceDocuments("org-1");
    expect(groups).toHaveLength(2);
    const bylaws = groups.find((group) => group.title === "Bylaws");
    expect(bylaws?.current?.id).toBe("v2");
    expect(bylaws?.versions).toHaveLength(2);
  });
});
