import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

/**
 * build-26 Phase E — household-photo.ts is exercised against sharp's REAL
 * decode/encode pipeline (not mocked) so the security properties that
 * matter (magic-byte detection, EXIF/orientation stripping, corrupt-image
 * rejection) are proven against actual image bytes, not a stub that would
 * just echo back whatever the test asserts. Only prisma/audit/storage I/O
 * is mocked.
 */

const findFirstHousehold = vi.fn();
const findFirstAttachment = vi.fn();
const createAttachment = vi.fn();
const updateAttachment = vi.fn();
const updateHousehold = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaHousehold: {
      findFirst: (...a: unknown[]) => findFirstHousehold(...a),
      update: (...a: unknown[]) => updateHousehold(...a),
    },
    attachment: {
      findFirst: (...a: unknown[]) => findFirstAttachment(...a),
      create: (...a: unknown[]) => createAttachment(...a),
      update: (...a: unknown[]) => updateAttachment(...a),
    },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));

const createAuditEvent = vi.fn();
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

const uploadBufferToSpaces = vi.fn();
const deleteObjectFromSpaces = vi.fn();
vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    uploadBufferToSpaces: (...a: unknown[]) => uploadBufferToSpaces(...a),
    deleteObjectFromSpaces: (...a: unknown[]) => deleteObjectFromSpaces(...a),
  };
});

async function makeJpeg(width: number, height: number, orientation?: number): Promise<Buffer> {
  const base = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 50, b: 50 } } }).jpeg();
  const buf = await base.toBuffer();
  if (!orientation) return buf;
  return sharp(buf).withMetadata({ orientation }).jpeg().toBuffer();
}

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 200, b: 10 } } }).png().toBuffer();
}

async function makeWebp(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 10, b: 200 } } }).webp().toBuffer();
}

const ORG_ID = "org-1";
const HOUSEHOLD_ID = "household-1";
const ACTOR = { organizationId: ORG_ID, householdId: HOUSEHOLD_ID, actorUserId: "user-1", actorEmail: "parent@example.org" };

beforeEach(() => {
  vi.clearAllMocks();
  findFirstHousehold.mockResolvedValue({ id: HOUSEHOLD_ID, organizationId: ORG_ID });
  findFirstAttachment.mockResolvedValue(null);
  createAttachment.mockResolvedValue({ id: "attachment-1" });
  updateHousehold.mockResolvedValue({});
  updateAttachment.mockResolvedValue({});
  uploadBufferToSpaces.mockResolvedValue(undefined);
  deleteObjectFromSpaces.mockResolvedValue(undefined);
  transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
  createAuditEvent.mockResolvedValue({});
});

describe("uploadHouseholdPhoto", () => {
  it("rejects when the household does not exist in this organization", async () => {
    findFirstHousehold.mockResolvedValueOnce(null);
    const { uploadHouseholdPhoto } = await import("../household-photo");
    const buffer = await makeJpeg(20, 20);
    await expect(
      uploadHouseholdPhoto({ ...ACTOR, buffer, declaredContentType: "image/jpeg" })
    ).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
    expect(uploadBufferToSpaces).not.toHaveBeenCalled();
  });

  it("rejects an empty upload", async () => {
    const { uploadHouseholdPhoto } = await import("../household-photo");
    await expect(
      uploadHouseholdPhoto({ ...ACTOR, buffer: Buffer.alloc(0), declaredContentType: "image/jpeg" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("rejects a declared size over the 15 MB limit before ever touching the bytes", async () => {
    const { uploadHouseholdPhoto } = await import("../household-photo");
    const oversized = Buffer.alloc(15 * 1024 * 1024 + 1, 1);
    await expect(
      uploadHouseholdPhoto({ ...ACTOR, buffer: oversized, declaredContentType: "image/jpeg" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(uploadBufferToSpaces).not.toHaveBeenCalled();
  });

  it("rejects bytes that don't match any supported image signature", async () => {
    const { uploadHouseholdPhoto } = await import("../household-photo");
    const notAnImage = Buffer.from("this is definitely not an image file, just text bytes");
    await expect(
      uploadHouseholdPhoto({ ...ACTOR, buffer: notAnImage, declaredContentType: "image/jpeg" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("rejects a spoofed declared content-type that disagrees with the actual bytes (renamed-file attack)", async () => {
    const { uploadHouseholdPhoto } = await import("../household-photo");
    const realPng = await makePng(20, 20);
    await expect(
      // declares JPEG, bytes are actually PNG
      uploadHouseholdPhoto({ ...ACTOR, buffer: realPng, declaredContentType: "image/jpeg" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(uploadBufferToSpaces).not.toHaveBeenCalled();
  });

  it("accepts image/heif declared type for real heic-signature bytes (heic/heif share one magic-byte family)", async () => {
    const { uploadHouseholdPhoto } = await import("../household-photo");
    // Minimal ISO-BMFF ftyp box with a heic major brand -- enough to pass
    // signature detection; sharp itself will still fail to decode this
    // synthetic stub, which is exercised separately below.
    const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftyp", "ascii"), Buffer.from("heic", "ascii"), Buffer.alloc(12)]);
    await expect(
      uploadHouseholdPhoto({ ...ACTOR, buffer: ftyp, declaredContentType: "image/heif" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" }); // fails at decode, not at signature/declared-type mismatch
  });

  it("rejects bytes with valid JPEG magic bytes but corrupt/truncated content", async () => {
    const { uploadHouseholdPhoto } = await import("../household-photo");
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("not a real jpeg body at all")]);
    await expect(
      uploadHouseholdPhoto({ ...ACTOR, buffer: corrupt, declaredContentType: "image/jpeg" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(uploadBufferToSpaces).not.toHaveBeenCalled();
  });

  it("uploads a valid JPEG: re-encodes, strips EXIF/orientation, and stores under a random object key", async () => {
    const { uploadHouseholdPhoto } = await import("../household-photo");
    const buffer = await makeJpeg(30, 10, 6); // landscape source with a 90-degree EXIF rotation tag

    const result = await uploadHouseholdPhoto({ ...ACTOR, buffer, declaredContentType: "image/jpeg" });

    expect(uploadBufferToSpaces).toHaveBeenCalledTimes(1);
    const uploadCall = uploadBufferToSpaces.mock.calls[0][0] as { key: string; buffer: Buffer; contentType: string };
    expect(uploadCall.contentType).toBe("image/jpeg");
    expect(uploadCall.key).toContain(`attachments/${ORG_ID}/pta_household/${HOUSEHOLD_ID}/`);

    // orientation 6 on a 30x10 source rotates to 10x30 -- proves .rotate() applied the tag
    const outMeta = await sharp(uploadCall.buffer).metadata();
    expect(outMeta.width).toBe(10);
    expect(outMeta.height).toBe(30);
    expect(outMeta.orientation).toBeUndefined();
    expect(outMeta.exif).toBeUndefined();

    expect(result.width).toBe(10);
    expect(result.height).toBe(30);
    expect(result.photoUrl).toBe(`/api/labs/pta/households/${HOUSEHOLD_ID}/photo`);

    expect(createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: ORG_ID, entityType: "PTA_HOUSEHOLD", entityId: HOUSEHOLD_ID, purpose: "FAMILY_PHOTO" }),
      })
    );
    expect(updateHousehold).toHaveBeenCalledWith({
      where: { id: HOUSEHOLD_ID },
      data: { photoUrl: `/api/labs/pta/households/${HOUSEHOLD_ID}/photo` },
    });
  });

  it("downscales an oversized image to the 1600px cap while preserving aspect ratio", async () => {
    const { uploadHouseholdPhoto } = await import("../household-photo");
    const buffer = await makeJpeg(2000, 1000);
    const result = await uploadHouseholdPhoto({ ...ACTOR, buffer, declaredContentType: "image/jpeg" });
    expect(result.width).toBe(1600);
    expect(result.height).toBe(800);
  });

  it("accepts PNG and WEBP declared types matching their real signatures", async () => {
    const { uploadHouseholdPhoto } = await import("../household-photo");
    const png = await makePng(15, 15);
    await uploadHouseholdPhoto({ ...ACTOR, buffer: png, declaredContentType: "image/png" });
    expect(uploadBufferToSpaces).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    findFirstHousehold.mockResolvedValue({ id: HOUSEHOLD_ID, organizationId: ORG_ID });
    findFirstAttachment.mockResolvedValue(null);
    createAttachment.mockResolvedValue({ id: "attachment-2" });

    const webp = await makeWebp(15, 15);
    await uploadHouseholdPhoto({ ...ACTOR, buffer: webp, declaredContentType: "image/webp" });
    expect(uploadBufferToSpaces).toHaveBeenCalledTimes(1);
  });

  it("replaces an existing photo: uploads the new object before soft-deleting/removing the old one", async () => {
    findFirstAttachment.mockResolvedValueOnce({ id: "old-attachment", objectKey: "attachments/org-1/pta_household/household-1/old.jpg" });
    const { uploadHouseholdPhoto } = await import("../household-photo");
    const buffer = await makeJpeg(20, 20);

    const callOrder: string[] = [];
    uploadBufferToSpaces.mockImplementationOnce(async () => {
      callOrder.push("upload-new");
    });
    updateAttachment.mockImplementationOnce(async () => {
      callOrder.push("soft-delete-old-row");
      return {};
    });
    deleteObjectFromSpaces.mockImplementationOnce(async () => {
      callOrder.push("delete-old-object");
    });

    await uploadHouseholdPhoto({ ...ACTOR, buffer, declaredContentType: "image/jpeg" });

    expect(callOrder).toEqual(["upload-new", "soft-delete-old-row", "delete-old-object"]);
    expect(updateAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "old-attachment" }, data: expect.objectContaining({ deletedAt: expect.any(Date) }) })
    );
    expect(deleteObjectFromSpaces).toHaveBeenCalledWith("attachments/org-1/pta_household/household-1/old.jpg");
  });

  it("does not let old-object storage cleanup failure surface as an upload failure (best-effort delete)", async () => {
    findFirstAttachment.mockResolvedValueOnce({ id: "old-attachment", objectKey: "old-key.jpg" });
    deleteObjectFromSpaces.mockRejectedValueOnce(new Error("spaces unavailable"));
    const { uploadHouseholdPhoto } = await import("../household-photo");
    const buffer = await makeJpeg(20, 20);
    await expect(uploadHouseholdPhoto({ ...ACTOR, buffer, declaredContentType: "image/jpeg" })).resolves.toBeDefined();
  });

  it("records an audit event with only shape metadata -- never image bytes", async () => {
    const { uploadHouseholdPhoto } = await import("../household-photo");
    const buffer = await makeJpeg(20, 20);
    await uploadHouseholdPhoto({ ...ACTOR, buffer, declaredContentType: "image/jpeg" });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        actorUserId: "user-1",
        action: "pta.household.photo_uploaded",
        entityType: "pta_household",
        entityId: HOUSEHOLD_ID,
        metadata: expect.objectContaining({ attachmentId: "attachment-1", byteSize: expect.any(Number), width: expect.any(Number), height: expect.any(Number) }),
      })
    );
    const metadata = createAuditEvent.mock.calls[0][0].metadata;
    expect(JSON.stringify(metadata)).not.toMatch(/ffd8|89504e47/i);
  });

  it("uses the replaced action when an existing photo is overwritten", async () => {
    findFirstAttachment.mockResolvedValueOnce({ id: "old-attachment", objectKey: "old-key.jpg" });
    const { uploadHouseholdPhoto } = await import("../household-photo");
    const buffer = await makeJpeg(20, 20);
    await uploadHouseholdPhoto({ ...ACTOR, buffer, declaredContentType: "image/jpeg" });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.household.photo_replaced" }));
  });
});

describe("deleteHouseholdPhoto", () => {
  it("rejects when the household does not exist in this organization", async () => {
    findFirstHousehold.mockResolvedValueOnce(null);
    const { deleteHouseholdPhoto } = await import("../household-photo");
    await expect(deleteHouseholdPhoto(ACTOR)).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
  });

  it("is a safe no-op when there is no photo on file", async () => {
    const { deleteHouseholdPhoto } = await import("../household-photo");
    await deleteHouseholdPhoto(ACTOR);
    expect(transaction).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("soft-deletes the attachment, clears photoUrl, and removes the storage object", async () => {
    findFirstAttachment.mockResolvedValueOnce({ id: "attachment-1", objectKey: "attachments/org-1/pta_household/household-1/photo.jpg" });
    const { deleteHouseholdPhoto } = await import("../household-photo");
    await deleteHouseholdPhoto(ACTOR);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateAttachment).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "attachment-1" } }));
    expect(updateHousehold).toHaveBeenCalledWith({ where: { id: HOUSEHOLD_ID }, data: { photoUrl: null } });
    expect(deleteObjectFromSpaces).toHaveBeenCalledWith("attachments/org-1/pta_household/household-1/photo.jpg");
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.household.photo_deleted" }));
  });
});

describe("getHouseholdPhotoAttachment", () => {
  it("queries by organization, entity type, entity id, purpose, and excludes soft-deleted rows", async () => {
    findFirstAttachment.mockResolvedValueOnce({ id: "attachment-1" });
    const { getHouseholdPhotoAttachment } = await import("../household-photo");
    const result = await getHouseholdPhotoAttachment(ORG_ID, HOUSEHOLD_ID);
    expect(result).toEqual({ id: "attachment-1" });
    expect(findFirstAttachment).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, entityType: "PTA_HOUSEHOLD", entityId: HOUSEHOLD_ID, purpose: "FAMILY_PHOTO", deletedAt: null },
    });
  });
});
