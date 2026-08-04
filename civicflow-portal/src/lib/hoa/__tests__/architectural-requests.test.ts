import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const findFirstProperty = vi.fn();
const findFirstArchitecturalRequest = vi.fn();
const createArchitecturalRequest = vi.fn();
const updateArchitecturalRequest = vi.fn();
const updateManyArchitecturalRequest = vi.fn();
const findUniqueOrThrowArchitecturalRequest = vi.fn();
const findManyArchitecturalRequest = vi.fn();
const createArchitecturalRequestComment = vi.fn();
const createArchitecturalRequestStatusHistory = vi.fn();
const findFirstOrgMember = vi.fn();
const findManyMobileDeviceToken = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);
const sendEmail = vi.fn().mockResolvedValue({ sent: true, skipped: false });
const sendPushToTokens = vi.fn().mockResolvedValue({ sent: 0, failed: 0 });

// Mirrors violations.test.ts's tx-client wiring: prisma.$transaction's
// callback must support the same calls as the top-level client, routed
// through the SAME mock functions so a test can assert on them regardless
// of which path (transactional or not) wrote the data.
const txClient = {
  architecturalRequest: {
    findFirst: (...a: unknown[]) => findFirstArchitecturalRequest(...a),
    create: (...a: unknown[]) => createArchitecturalRequest(...a),
    updateMany: (...a: unknown[]) => updateManyArchitecturalRequest(...a),
    findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrowArchitecturalRequest(...a),
  },
  architecturalRequestStatusHistory: { create: (...a: unknown[]) => createArchitecturalRequestStatusHistory(...a) },
};
const transaction = vi.fn((fn: (tx: typeof txClient) => unknown) => fn(txClient));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...a: Parameters<typeof transaction>) => transaction(...a),
    property: { findFirst: (...a: unknown[]) => findFirstProperty(...a) },
    architecturalRequest: {
      findFirst: (...a: unknown[]) => findFirstArchitecturalRequest(...a),
      create: (...a: unknown[]) => createArchitecturalRequest(...a),
      update: (...a: unknown[]) => updateArchitecturalRequest(...a),
      updateMany: (...a: unknown[]) => updateManyArchitecturalRequest(...a),
      findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrowArchitecturalRequest(...a),
      findMany: (...a: unknown[]) => findManyArchitecturalRequest(...a),
    },
    architecturalRequestComment: { create: (...a: unknown[]) => createArchitecturalRequestComment(...a) },
    architecturalRequestStatusHistory: { create: (...a: unknown[]) => createArchitecturalRequestStatusHistory(...a) },
    orgMember: { findFirst: (...a: unknown[]) => findFirstOrgMember(...a) },
    mobileDeviceToken: { findMany: (...a: unknown[]) => findManyMobileDeviceToken(...a) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));
vi.mock("@/lib/mail", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/push", () => ({ sendPushToTokens: (...a: unknown[]) => sendPushToTokens(...a) }));

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation((fn: (tx: typeof txClient) => unknown) => fn(txClient));
  updateManyArchitecturalRequest.mockResolvedValue({ count: 1 });
  findFirstOrgMember.mockResolvedValue({ userId: "user-1", email: "submitter@example.org", commsEmailEnabled: true, commsPushEnabled: false });
  findManyMobileDeviceToken.mockResolvedValue([]);
});

function p2002(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test", meta: { target } });
}

describe("assertValidTransition / isTerminalStatus", () => {
  it.each([
    ["DRAFT", "SUBMITTED"],
    ["DRAFT", "WITHDRAWN"],
    ["SUBMITTED", "IN_REVIEW"],
    ["SUBMITTED", "WITHDRAWN"],
    ["IN_REVIEW", "CHANGES_REQUESTED"],
    ["IN_REVIEW", "APPROVED"],
    ["IN_REVIEW", "CONDITIONALLY_APPROVED"],
    ["IN_REVIEW", "DENIED"],
    ["CHANGES_REQUESTED", "RESUBMITTED"],
    ["CHANGES_REQUESTED", "WITHDRAWN"],
    ["RESUBMITTED", "IN_REVIEW"],
    ["APPROVED", "EXPIRED"],
    ["CONDITIONALLY_APPROVED", "EXPIRED"],
  ] as const)("allows %s -> %s", async (from, to) => {
    const { assertValidTransition } = await import("../architectural-requests");
    expect(() => assertValidTransition(from, to)).not.toThrow();
  });

  it.each([
    ["DRAFT", "APPROVED"],
    ["DRAFT", "IN_REVIEW"],
    ["SUBMITTED", "APPROVED"],
    ["SUBMITTED", "RESUBMITTED"],
    ["IN_REVIEW", "RESUBMITTED"],
    ["IN_REVIEW", "WITHDRAWN"],
    ["CHANGES_REQUESTED", "IN_REVIEW"],
    ["RESUBMITTED", "WITHDRAWN"],
    ["RESUBMITTED", "APPROVED"],
    ["APPROVED", "DENIED"],
    ["DENIED", "IN_REVIEW"],
    ["WITHDRAWN", "SUBMITTED"],
    ["EXPIRED", "APPROVED"],
  ] as const)("rejects %s -> %s", async (from, to) => {
    const { assertValidTransition } = await import("../architectural-requests");
    expect(() => assertValidTransition(from, to)).toThrow();
  });

  it("treats APPROVED, CONDITIONALLY_APPROVED, DENIED, WITHDRAWN, and EXPIRED as terminal", async () => {
    const { isTerminalStatus } = await import("../architectural-requests");
    expect(isTerminalStatus("APPROVED")).toBe(true);
    expect(isTerminalStatus("CONDITIONALLY_APPROVED")).toBe(true);
    expect(isTerminalStatus("DENIED")).toBe(true);
    expect(isTerminalStatus("WITHDRAWN")).toBe(true);
    expect(isTerminalStatus("EXPIRED")).toBe(true);
    expect(isTerminalStatus("DRAFT")).toBe(false);
    expect(isTerminalStatus("IN_REVIEW")).toBe(false);
  });
});

describe("createArchitecturalRequestDraft", () => {
  it("404s when the property doesn't exist in this organization", async () => {
    findFirstProperty.mockResolvedValueOnce(null);
    const { createArchitecturalRequestDraft } = await import("../architectural-requests");

    await expect(
      createArchitecturalRequestDraft({
        organizationId: "org-1",
        propertyId: "prop-1",
        submittedByOrgMemberId: "member-1",
        category: "FENCE",
        title: "New fence",
        projectDescription: "6ft privacy fence",
      })
    ).rejects.toMatchObject({ code: "HOA_PROPERTY_NOT_FOUND" });
  });

  it("creates a DRAFT and writes one status-history row inside the transaction", async () => {
    findFirstProperty.mockResolvedValueOnce({ id: "prop-1" });
    createArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "DRAFT" });

    const { createArchitecturalRequestDraft } = await import("../architectural-requests");
    const result = await createArchitecturalRequestDraft({
      organizationId: "org-1",
      propertyId: "prop-1",
      submittedByOrgMemberId: "member-1",
      category: "FENCE",
      title: "New fence",
      projectDescription: "6ft privacy fence",
    });

    expect(result.id).toBe("request-1");
    expect(createArchitecturalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DRAFT", submittedByOrgMemberId: "member-1" }) })
    );
    expect(createArchitecturalRequestStatusHistory).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fromStatus: null, toStatus: "DRAFT" }) })
    );
    expect(createAuditEvent).toHaveBeenCalled();
  });
});

describe("updateArchitecturalRequestDraft", () => {
  it("rejects editing a request that belongs to a different submitter", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "DRAFT", submittedByOrgMemberId: "someone-else" });
    const { updateArchitecturalRequestDraft } = await import("../architectural-requests");

    await expect(
      updateArchitecturalRequestDraft({ organizationId: "org-1", requestId: "request-1", submittedByOrgMemberId: "member-1", title: "New title" })
    ).rejects.toMatchObject({ code: "HOA_ARCHITECTURAL_REQUEST_NOT_YOURS" });
  });

  it("rejects editing a request that is no longer DRAFT", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "SUBMITTED", submittedByOrgMemberId: "member-1" });
    const { updateArchitecturalRequestDraft } = await import("../architectural-requests");

    await expect(
      updateArchitecturalRequestDraft({ organizationId: "org-1", requestId: "request-1", submittedByOrgMemberId: "member-1", title: "New title" })
    ).rejects.toMatchObject({ code: "HOA_ARCHITECTURAL_REQUEST_INVALID_TRANSITION" });
  });

  it("edits via a conditional updateMany (compare-and-swap) that repeats status: DRAFT and the submitter in the WHERE clause", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "DRAFT", submittedByOrgMemberId: "member-1" });
    findUniqueOrThrowArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "DRAFT", title: "New title" });

    const { updateArchitecturalRequestDraft } = await import("../architectural-requests");
    const result = await updateArchitecturalRequestDraft({ organizationId: "org-1", requestId: "request-1", submittedByOrgMemberId: "member-1", title: "New title" });

    expect(result.title).toBe("New title");
    expect(updateManyArchitecturalRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "request-1", organizationId: "org-1", submittedByOrgMemberId: "member-1", status: "DRAFT" },
        data: expect.objectContaining({ title: "New title" }),
      })
    );
  });

  it("rejects a stale-update race (e.g. the request was submitted between the read and the write) with HOA_ARCHITECTURAL_REQUEST_STALE_UPDATE", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "DRAFT", submittedByOrgMemberId: "member-1" });
    updateManyArchitecturalRequest.mockResolvedValueOnce({ count: 0 });

    const { updateArchitecturalRequestDraft } = await import("../architectural-requests");
    await expect(
      updateArchitecturalRequestDraft({ organizationId: "org-1", requestId: "request-1", submittedByOrgMemberId: "member-1", title: "New title" })
    ).rejects.toMatchObject({ code: "HOA_ARCHITECTURAL_REQUEST_STALE_UPDATE" });
  });
});

describe("submitArchitecturalRequest", () => {
  it("transitions DRAFT -> SUBMITTED via a conditional updateMany (compare-and-swap) and notifies the submitter", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "DRAFT", submittedByOrgMemberId: "member-1" });
    findUniqueOrThrowArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "SUBMITTED", title: "New fence" });

    const { submitArchitecturalRequest } = await import("../architectural-requests");
    const result = await submitArchitecturalRequest({ organizationId: "org-1", requestId: "request-1", submittedByOrgMemberId: "member-1" });

    expect(result.status).toBe("SUBMITTED");
    expect(updateManyArchitecturalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "request-1", organizationId: "org-1", status: "DRAFT" } })
    );
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "submitter@example.org" }));
  });

  it("rejects submitting someone else's request", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "DRAFT", submittedByOrgMemberId: "someone-else" });
    const { submitArchitecturalRequest } = await import("../architectural-requests");

    await expect(
      submitArchitecturalRequest({ organizationId: "org-1", requestId: "request-1", submittedByOrgMemberId: "member-1" })
    ).rejects.toMatchObject({ code: "HOA_ARCHITECTURAL_REQUEST_NOT_YOURS" });
    expect(updateManyArchitecturalRequest).not.toHaveBeenCalled();
  });

  it("rejects a stale-update race (updateMany count 0) with HOA_ARCHITECTURAL_REQUEST_STALE_UPDATE", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "DRAFT", submittedByOrgMemberId: "member-1" });
    updateManyArchitecturalRequest.mockResolvedValueOnce({ count: 0 });
    const { submitArchitecturalRequest } = await import("../architectural-requests");

    await expect(
      submitArchitecturalRequest({ organizationId: "org-1", requestId: "request-1", submittedByOrgMemberId: "member-1" })
    ).rejects.toMatchObject({ code: "HOA_ARCHITECTURAL_REQUEST_STALE_UPDATE" });
    expect(createArchitecturalRequestStatusHistory).not.toHaveBeenCalled();
  });
});

describe("withdrawArchitecturalRequest", () => {
  it.each(["DRAFT", "SUBMITTED", "CHANGES_REQUESTED"] as const)("withdraws from %s", async (from) => {
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: from, submittedByOrgMemberId: "member-1" });
    findUniqueOrThrowArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "WITHDRAWN" });

    const { withdrawArchitecturalRequest } = await import("../architectural-requests");
    const result = await withdrawArchitecturalRequest({ organizationId: "org-1", requestId: "request-1", submittedByOrgMemberId: "member-1" });

    expect(result.status).toBe("WITHDRAWN");
  });

  it("rejects withdrawing from IN_REVIEW -- not in the allowed withdrawal source set", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "IN_REVIEW", submittedByOrgMemberId: "member-1" });
    const { withdrawArchitecturalRequest } = await import("../architectural-requests");

    await expect(
      withdrawArchitecturalRequest({ organizationId: "org-1", requestId: "request-1", submittedByOrgMemberId: "member-1" })
    ).rejects.toMatchObject({ code: "HOA_ARCHITECTURAL_REQUEST_INVALID_TRANSITION" });
  });
});

describe("resubmitArchitecturalRequest", () => {
  it("transitions CHANGES_REQUESTED -> RESUBMITTED and updates fields in the same write", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "CHANGES_REQUESTED", submittedByOrgMemberId: "member-1" });
    findUniqueOrThrowArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "RESUBMITTED", title: "Updated fence plan" });

    const { resubmitArchitecturalRequest } = await import("../architectural-requests");
    const result = await resubmitArchitecturalRequest({
      organizationId: "org-1",
      requestId: "request-1",
      submittedByOrgMemberId: "member-1",
      projectDescription: "Updated to 5ft per board feedback",
    });

    expect(result.status).toBe("RESUBMITTED");
    expect(updateManyArchitecturalRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "request-1", organizationId: "org-1", status: "CHANGES_REQUESTED" },
        data: expect.objectContaining({ status: "RESUBMITTED", projectDescription: "Updated to 5ft per board feedback" }),
      })
    );
  });
});

describe("transitionArchitecturalRequestStatus (officer-initiated)", () => {
  it("moves SUBMITTED -> IN_REVIEW and notifies the submitter", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "SUBMITTED", submittedByOrgMemberId: "member-1" });
    findUniqueOrThrowArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "IN_REVIEW", title: "New fence" });

    const { transitionArchitecturalRequestStatus } = await import("../architectural-requests");
    const result = await transitionArchitecturalRequestStatus({ organizationId: "org-1", requestId: "request-1", toStatus: "IN_REVIEW", actorUserId: "officer-1" });

    expect(result.status).toBe("IN_REVIEW");
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "submitter@example.org" }));
  });

  it("approving stamps decidedAt/decidedByUserId/decisionSummary and includes conditions only for CONDITIONALLY_APPROVED", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "IN_REVIEW", submittedByOrgMemberId: "member-1" });
    findUniqueOrThrowArchitecturalRequest.mockResolvedValueOnce({
      id: "request-1",
      status: "CONDITIONALLY_APPROVED",
      title: "New fence",
      conditions: "Must match neighborhood palette",
    });

    const { transitionArchitecturalRequestStatus } = await import("../architectural-requests");
    await transitionArchitecturalRequestStatus({
      organizationId: "org-1",
      requestId: "request-1",
      toStatus: "CONDITIONALLY_APPROVED",
      actorUserId: "officer-1",
      decisionSummary: "Approved with a color condition.",
      conditions: "Must match neighborhood palette",
    });

    expect(updateManyArchitecturalRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CONDITIONALLY_APPROVED",
          decidedByUserId: "officer-1",
          decisionSummary: "Approved with a color condition.",
          conditions: "Must match neighborhood palette",
        }),
      })
    );
  });

  it("does not set decidedAt/decidedByUserId for a non-decision transition (IN_REVIEW)", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "SUBMITTED", submittedByOrgMemberId: "member-1" });
    findUniqueOrThrowArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "IN_REVIEW", title: "New fence" });

    const { transitionArchitecturalRequestStatus } = await import("../architectural-requests");
    await transitionArchitecturalRequestStatus({ organizationId: "org-1", requestId: "request-1", toStatus: "IN_REVIEW", actorUserId: "officer-1" });

    const call = updateManyArchitecturalRequest.mock.calls[0][0];
    expect(call.data.decidedAt).toBeUndefined();
    expect(call.data.decidedByUserId).toBeUndefined();
  });

  it("rejects a stale-update race with HOA_ARCHITECTURAL_REQUEST_STALE_UPDATE", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "IN_REVIEW", submittedByOrgMemberId: "member-1" });
    updateManyArchitecturalRequest.mockResolvedValueOnce({ count: 0 });
    const { transitionArchitecturalRequestStatus } = await import("../architectural-requests");

    await expect(
      transitionArchitecturalRequestStatus({ organizationId: "org-1", requestId: "request-1", toStatus: "APPROVED", actorUserId: "officer-1" })
    ).rejects.toMatchObject({ code: "HOA_ARCHITECTURAL_REQUEST_STALE_UPDATE" });
  });

  it("does not fail the API call when notification delivery throws after the transition already committed", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "IN_REVIEW", submittedByOrgMemberId: "member-1" });
    findUniqueOrThrowArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "DENIED", title: "New fence" });
    sendEmail.mockRejectedValueOnce(new Error("SMTP provider outage"));

    const { transitionArchitecturalRequestStatus } = await import("../architectural-requests");
    const result = await transitionArchitecturalRequestStatus({
      organizationId: "org-1",
      requestId: "request-1",
      toStatus: "DENIED",
      actorUserId: "officer-1",
      decisionSummary: "Does not conform to guidelines.",
    });

    expect(result.status).toBe("DENIED");
  });
});

describe("addArchitecturalRequestComment", () => {
  it("404s when the request doesn't exist in this organization", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce(null);
    const { addArchitecturalRequestComment } = await import("../architectural-requests");

    await expect(
      addArchitecturalRequestComment({ organizationId: "org-1", requestId: "request-1", body: "note", isPrivate: true, actorUserId: "officer-1" })
    ).rejects.toMatchObject({ code: "HOA_ARCHITECTURAL_REQUEST_NOT_FOUND" });
  });

  it("defaults to private and creates a comment", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1" });
    createArchitecturalRequestComment.mockResolvedValueOnce({ id: "comment-1", isPrivate: true });

    const { addArchitecturalRequestComment } = await import("../architectural-requests");
    await addArchitecturalRequestComment({ organizationId: "org-1", requestId: "request-1", body: "note", isPrivate: true, actorUserId: "officer-1" });

    expect(createArchitecturalRequestComment).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isPrivate: true }) }));
  });
});

describe("toResidentSafeArchitecturalRequest", () => {
  it("strips decidedByUserId (never even read) and filters out private comments", async () => {
    const request = {
      id: "request-1",
      propertyId: "prop-1",
      requestNumber: 42,
      category: "FENCE",
      title: "New fence",
      projectDescription: "desc",
      proposedStartDate: null,
      proposedCompletionDate: null,
      status: "IN_REVIEW" as const,
      submittedAt: new Date(),
      decidedAt: null,
      decisionSummary: null,
      conditions: null,
      expirationDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      comments: [
        { id: "c1", body: "internal note", isPrivate: true, createdAt: new Date() },
        { id: "c2", body: "looks good", isPrivate: false, createdAt: new Date() },
      ],
    };
    const { toResidentSafeArchitecturalRequest } = await import("../architectural-requests");
    const safe = toResidentSafeArchitecturalRequest(request);

    expect(safe).not.toHaveProperty("decidedByUserId");
    expect(safe.comments).toHaveLength(1);
    expect(safe.comments[0].id).toBe("c2");
  });
});

describe("p2002 helper sanity", () => {
  it("constructs a real PrismaClientKnownRequestError with code P2002", () => {
    const err = p2002(["requestId"]);
    expect(err.code).toBe("P2002");
  });
});
