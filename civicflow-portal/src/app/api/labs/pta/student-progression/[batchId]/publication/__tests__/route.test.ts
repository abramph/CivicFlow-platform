import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Publication route authorization. The service tests cover the publication
 * rules themselves, so this file proves only what the route owns: the right
 * permission on the right verb, authorization before body parsing, the
 * server-resolved organization id, and that publishing requires the
 * dedicated PUBLISH permission rather than merely COMMIT.
 */

const requirePtaAccess = vi.fn();
vi.mock("@/lib/labs/pta/guard", () => ({ requirePtaAccess: (...a: unknown[]) => requirePtaAccess(...a) }));

const getProgressionPublicationStatus = vi.fn();
const publishProgressionResults = vi.fn();
const unpublishProgressionResults = vi.fn();
vi.mock("@/lib/labs/pta/progression-publication", () => ({
  getProgressionPublicationStatus: (...a: unknown[]) => getProgressionPublicationStatus(...a),
  publishProgressionResults: (...a: unknown[]) => publishProgressionResults(...a),
  unpublishProgressionResults: (...a: unknown[]) => unpublishProgressionResults(...a),
}));

import { PERMISSIONS } from "@/lib/rbac";
import { PtaError } from "@/lib/labs/pta/errors";
import * as route from "../route";

const ORG = "org-1";
const BATCH = "batch-1";
const params = Promise.resolve({ batchId: BATCH });

function jsonRequest(body: unknown, method = "POST") {
  return new Request("https://x.test/api/labs/pta/student-progression/batch-1/publication", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePtaAccess.mockResolvedValue({ organizationId: ORG, session: { userId: "user-1", userEmail: "admin@example.org" } });
  getProgressionPublicationStatus.mockResolvedValue({ batchId: BATCH, publicationStatus: "UNPUBLISHED", canPublish: true });
  publishProgressionResults.mockResolvedValue({ batchId: BATCH, publicationStatus: "PUBLISHED", publicationVersion: 1 });
  unpublishProgressionResults.mockResolvedValue({ batchId: BATCH, publicationStatus: "WITHDRAWN", publicationVersion: 2 });
});

describe("GET publication status", () => {
  it("requires the preview permission and returns status", async () => {
    const response = await route.GET(new Request("https://x.test/p"), { params });
    expect(requirePtaAccess).toHaveBeenCalledWith(PERMISSIONS.PTA_STUDENT_PROGRESSION_PREVIEW);
    expect(response.status).toBe(200);
    expect(getProgressionPublicationStatus).toHaveBeenCalledWith(ORG, BATCH);
  });

  it("propagates a permission denial", async () => {
    requirePtaAccess.mockRejectedValue(new PtaError("PTA_ORGANIZATION_NOT_PTA_VERTICAL", "not pta"));
    const response = await route.GET(new Request("https://x.test/p"), { params });
    expect(response.status).toBe(403);
    expect(getProgressionPublicationStatus).not.toHaveBeenCalled();
  });
});

describe("POST publish", () => {
  it("requires the dedicated PUBLISH permission, not merely COMMIT", async () => {
    await route.POST(jsonRequest({ publicationVersion: 0, idempotencyKey: "k" }), { params });
    expect(requirePtaAccess).toHaveBeenCalledWith(PERMISSIONS.PTA_STUDENT_PROGRESSION_PUBLISH);
    expect(requirePtaAccess).not.toHaveBeenCalledWith(PERMISSIONS.PTA_STUDENT_PROGRESSION_COMMIT);
  });

  it("authorizes BEFORE parsing the request body", async () => {
    requirePtaAccess.mockRejectedValue(new PtaError("PTA_ORGANIZATION_NOT_PTA_VERTICAL", "not pta"));
    // Deliberately unparseable body: if authorization ran second, this would
    // surface as a parse error rather than a clean 403.
    const bad = new Request("https://x.test/p", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    const response = await route.POST(bad, { params });
    expect(response.status).toBe(403);
    expect(publishProgressionResults).not.toHaveBeenCalled();
  });

  it("passes the server-resolved organization and actor, never client-supplied values", async () => {
    await route.POST(jsonRequest({ publicationVersion: 2, idempotencyKey: "key-1", organizationId: "org-injected" }), { params });
    expect(publishProgressionResults).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, batchId: BATCH, publicationVersion: 2, idempotencyKey: "key-1", actorUserId: "user-1" })
    );
  });

  it("rejects a body without an idempotency key", async () => {
    const response = await route.POST(jsonRequest({ publicationVersion: 0 }), { params });
    expect(response.status).toBe(400);
    expect(publishProgressionResults).not.toHaveBeenCalled();
  });

  it("rejects a body without a publication version", async () => {
    const response = await route.POST(jsonRequest({ idempotencyKey: "k" }), { params });
    expect(response.status).toBe(400);
  });

  it("surfaces a blocked publication as a stable 409 code", async () => {
    publishProgressionResults.mockRejectedValue(new PtaError("PTA_PROGRESSION_PUBLISH_BLOCKED", "blocked"));
    const response = await route.POST(jsonRequest({ publicationVersion: 0, idempotencyKey: "k" }), { params });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("PTA_PROGRESSION_PUBLISH_BLOCKED");
  });

  it("surfaces a stale publication attempt as a stable 409 code", async () => {
    publishProgressionResults.mockRejectedValue(new PtaError("PTA_PROGRESSION_PUBLICATION_STALE", "stale"));
    const response = await route.POST(jsonRequest({ publicationVersion: 0, idempotencyKey: "k" }), { params });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("PTA_PROGRESSION_PUBLICATION_STALE");
  });
});

describe("DELETE unpublish", () => {
  it("requires the PUBLISH permission and withdraws", async () => {
    const response = await route.DELETE(jsonRequest({ publicationVersion: 1 }, "DELETE"), { params });
    expect(requirePtaAccess).toHaveBeenCalledWith(PERMISSIONS.PTA_STUDENT_PROGRESSION_PUBLISH);
    expect(response.status).toBe(200);
    expect(unpublishProgressionResults).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, batchId: BATCH, publicationVersion: 1, actorUserId: "user-1" })
    );
  });

  it("rejects an unpublish for a batch that is not published", async () => {
    unpublishProgressionResults.mockRejectedValue(new PtaError("PTA_PROGRESSION_NOT_PUBLISHED", "not published"));
    const response = await route.DELETE(jsonRequest({ publicationVersion: 0 }, "DELETE"), { params });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("PTA_PROGRESSION_NOT_PUBLISHED");
  });
});

describe("route surface", () => {
  it("exposes no PUT or PATCH — publication has exactly three operations", () => {
    expect(route).not.toHaveProperty("PUT");
    expect(route).not.toHaveProperty("PATCH");
  });
});
