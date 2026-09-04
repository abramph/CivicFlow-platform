import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The generic attachment download route used to end in
 * NextResponse.redirect(getSignedObjectUrl(key, 300)), handing the caller a
 * bearer credential for the object itself. The attachments behind this route
 * include reimbursement receipts, payment reports, meeting recordings and
 * organization logos. These tests pin the replacement contract: authorize
 * first, then stream the bytes, and never name storage in the response.
 */

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return { ...actual, requirePermission: (...a: unknown[]) => requirePermission(...a) };
});

const verifyAttachmentOwnership = vi.fn();
vi.mock("@/lib/attachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/attachments")>();
  return { ...actual, verifyAttachmentOwnership: (...a: unknown[]) => verifyAttachmentOwnership(...a) };
});

const findFirstAttachment = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { attachment: { findFirst: (...a: unknown[]) => findFirstAttachment(...a) } },
}));

const getObjectStream = vi.fn();
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return { ...actual, getObjectStream: (...a: unknown[]) => getObjectStream(...a) };
});

const ORG_ID = "org-1";
const OBJECT_KEY = "attachments/org-1/reimbursement/req-1/receipt.pdf";

const params = (id = "attachment-1") => ({ params: Promise.resolve({ id }) });

function streamOf(bytes: Uint8Array) {
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    contentLength: bytes.byteLength,
  };
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7

beforeEach(() => {
  vi.clearAllMocks();
  findFirstAttachment.mockResolvedValue({
    organizationId: ORG_ID,
    entityType: "REIMBURSEMENT",
    entityId: "req-1",
    objectKey: OBJECT_KEY,
    contentType: "application/pdf",
    fileName: "October receipt.pdf",
    byteSize: PDF_BYTES.byteLength,
  });
  requirePermission.mockResolvedValue({ organizationId: ORG_ID, session: { userId: "user-1" }, can: () => true });
  verifyAttachmentOwnership.mockResolvedValue(true);
  getObjectStream.mockResolvedValue(streamOf(PDF_BYTES));
});

describe("GET /api/attachments/[id]/download", () => {
  it("streams the bytes instead of redirecting to object storage", async () => {
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/x"), params());

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("never names storage anywhere in the response", async () => {
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/x"), params());
    const headers = JSON.stringify([...res.headers.entries()]);

    expect(headers).not.toContain(OBJECT_KEY);
    expect(headers).not.toMatch(/digitaloceanspaces|amazonaws/i);
    expect(headers).not.toMatch(/X-Amz-Signature|X-Amz-Credential/i);
  });

  it("sets privacy-safe caching and sniffing headers", async () => {
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/x"), params());

    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("serves the stored content type, not anything derived from the request", async () => {
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/x"), params());
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("offers a non-renderable file as a download, under its ORIGINAL filename", async () => {
    findFirstAttachment.mockResolvedValueOnce({
      organizationId: ORG_ID, entityType: "REIMBURSEMENT", entityId: "req-1", objectKey: OBJECT_KEY,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: "Budget Q3.xlsx", byteSize: 8,
    });
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/x"), params());
    // A redirect to storage produced whatever the object key's last segment
    // happened to be; the real filename is a genuine improvement.
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="Budget Q3.xlsx"');
  });

  it("keeps a renderable type inline, so an <img src> such as an organization logo still works", async () => {
    findFirstAttachment.mockResolvedValueOnce({
      organizationId: ORG_ID, entityType: "ORGANIZATION", entityId: ORG_ID, objectKey: "attachments/org-1/organization/org-1/logo.png",
      contentType: "image/png", fileName: "logo.png", byteSize: 8,
    });
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/x"), params());
    expect(res.headers.get("content-disposition")).toBe('inline; filename="logo.png"');
  });

  it("sanitizes a hostile filename before it reaches Content-Disposition", async () => {
    findFirstAttachment.mockResolvedValueOnce({
      organizationId: ORG_ID, entityType: "REIMBURSEMENT", entityId: "req-1", objectKey: OBJECT_KEY,
      contentType: "application/octet-stream", fileName: 'evil";\r\nSet-Cookie: a=b', byteSize: 8,
    });
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/x"), params());
    const disposition = res.headers.get("content-disposition") ?? "";
    // What matters is that the header cannot be SPLIT or terminated early:
    // no CR, no LF, and no unescaped quote to close the filename token. The
    // hostile text surviving as inert characters inside the quoted value is
    // fine -- it is a save-dialog suggestion, not a header of its own.
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition.slice('attachment; filename="'.length, -1)).not.toContain('"');
    expect(disposition.startsWith('attachment; filename="')).toBe(true);
    expect(disposition.endsWith('"')).toBe(true);
  });

  it("does not open the object until authorization has passed", async () => {
    requirePermission.mockRejectedValueOnce(Object.assign(new Error("forbidden"), { name: "ForbiddenError" }));
    const { GET } = await import("../route");
    await GET(new Request("https://portal.test/x"), params()).catch(() => null);
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  it("refuses an attachment belonging to another organization, without touching storage", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-2", session: { userId: "user-1" }, can: () => true });
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/x"), params());

    expect(res.status).toBe(404);
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  it("refuses a caller who fails the ownership check, without touching storage", async () => {
    verifyAttachmentOwnership.mockResolvedValueOnce(false);
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/x"), params());

    expect(res.status).toBe(404);
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing or soft-deleted attachment", async () => {
    findFirstAttachment.mockResolvedValueOnce(null);
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/x"), params());

    expect(res.status).toBe(404);
    expect(requirePermission).not.toHaveBeenCalled();
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  it("excludes soft-deleted rows in the lookup itself", async () => {
    const { GET } = await import("../route");
    await GET(new Request("https://portal.test/x"), params());
    expect(findFirstAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) })
    );
  });

  it("reports a metadata row whose object is gone as 404, leaking no storage detail", async () => {
    getObjectStream.mockRejectedValueOnce(new Error(`NoSuchKey: ${OBJECT_KEY} in bucket civicflow-uploads`));
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/x"), params());

    expect(res.status).toBe(404);
    const payload = await res.json();
    expect(JSON.stringify(payload)).not.toContain(OBJECT_KEY);
    expect(JSON.stringify(payload)).not.toContain("bucket");
  });
});
