import { beforeEach, describe, expect, it, vi } from "vitest";

const auditEventCreate = vi.fn().mockResolvedValue({ id: "event-1" });
vi.mock("@/lib/prisma", () => ({
  prisma: { auditEvent: { create: (...args: unknown[]) => auditEventCreate(...args) } },
}));

const readImpersonationCookiePayload = vi.fn();
vi.mock("@/lib/impersonation", () => ({
  readImpersonationCookiePayload: (...args: unknown[]) => readImpersonationCookiePayload(...args),
}));

import { createAuditEvent } from "@/lib/audit";

describe("createAuditEvent — impersonation attribution", () => {
  beforeEach(() => {
    auditEventCreate.mockClear();
    readImpersonationCookiePayload.mockReset();
  });

  it("stamps impersonatedByUserId/Email when the recorded actor is the currently-impersonated target", async () => {
    readImpersonationCookiePayload.mockResolvedValueOnce({
      actorUserId: "admin-1",
      actorEmail: "admin@unestra.example",
      targetUserId: "member-1",
      organizationId: "org-a",
      sessionId: "sess-1",
      startedAt: new Date().toISOString(),
      reason: null,
      priorActiveOrgId: null,
    });

    await createAuditEvent({
      organizationId: "org-a",
      actorUserId: "member-1",
      actorEmail: "member@example.com",
      action: "communication_campaign.send",
      entityType: "communication_campaign",
      entityId: "campaign-1",
    });

    expect(auditEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: "member-1",
          impersonatedByUserId: "admin-1",
          impersonatedByEmail: "admin@unestra.example",
        }),
      })
    );
  });

  it("leaves impersonatedByUserId/Email null when nobody is being impersonated", async () => {
    readImpersonationCookiePayload.mockResolvedValueOnce(null);

    await createAuditEvent({
      organizationId: "org-a",
      actorUserId: "member-1",
      actorEmail: "member@example.com",
      action: "member.update",
      entityType: "member",
      entityId: "member-1",
    });

    expect(auditEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ impersonatedByUserId: null, impersonatedByEmail: null }),
      })
    );
  });

  it("does not tag the actor's own actions as impersonated just because a session is impersonating someone else", async () => {
    readImpersonationCookiePayload.mockResolvedValueOnce({
      actorUserId: "admin-1",
      actorEmail: "admin@unestra.example",
      targetUserId: "member-1",
      organizationId: "org-a",
      sessionId: "sess-1",
      startedAt: new Date().toISOString(),
      reason: null,
      priorActiveOrgId: null,
    });

    // e.g. the "platform.impersonation.started" audit event itself, whose
    // actorUserId is the real admin, not the target being impersonated.
    await createAuditEvent({
      organizationId: "org-a",
      actorUserId: "admin-1",
      actorEmail: "admin@unestra.example",
      action: "platform.impersonation.started",
      entityType: "impersonation_session",
      entityId: "sess-1",
    });

    expect(auditEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ impersonatedByUserId: null, impersonatedByEmail: null }),
      })
    );
  });

  it("falls back to null (not a thrown error) when called outside a request scope", async () => {
    readImpersonationCookiePayload.mockRejectedValueOnce(
      new Error("`cookies` was called outside a request scope.")
    );

    await expect(
      createAuditEvent({
        organizationId: null,
        actorUserId: "user-1",
        action: "cron.run",
        entityType: "scheduled_job",
      })
    ).resolves.toBeDefined();

    expect(auditEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ impersonatedByUserId: null, impersonatedByEmail: null }),
      })
    );
  });

  it("does not call readImpersonationCookiePayload at all when actorUserId is absent", async () => {
    await createAuditEvent({
      organizationId: "org-a",
      action: "webhook.received",
      entityType: "stripe_event",
    });

    expect(readImpersonationCookiePayload).not.toHaveBeenCalled();
  });
});
