import { describe, expect, it, vi } from "vitest";
import { parseArgs, executeCommand, type PlatformAdminPrisma } from "@/lib/platform-admin-cli";

function makePrisma(overrides: Partial<{
  user: { id: string; email: string; displayName: string | null } | null;
  actor: { id: string; email: string } | null;
  existing: { id: string; status: "ACTIVE" | "SUSPENDED" | "REVOKED" } | null;
}> = {}) {
  const findUniqueUser = vi.fn(async ({ where }: { where: { email: string } }) => {
    if (overrides.actor && where.email === overrides.actor.email) return overrides.actor;
    return overrides.user ?? null;
  });
  const findUniquePlatformAccess = vi.fn().mockResolvedValue(overrides.existing ?? null);
  const create = vi.fn().mockResolvedValue({ id: "pa-new" });
  const update = vi.fn().mockResolvedValue({ id: "pa-updated" });
  const auditCreate = vi.fn().mockResolvedValue(undefined);

  const prisma: PlatformAdminPrisma = {
    user: { findUnique: findUniqueUser },
    platformAccess: { findUnique: findUniquePlatformAccess, create, update },
    auditEvent: { create: auditCreate },
  };

  return { prisma, findUniqueUser, findUniquePlatformAccess, create, update, auditCreate };
}

describe("parseArgs", () => {
  it("accepts a well-formed grant command", () => {
    const result = parseArgs(["grant", "admin@example.com", "--reason", "onboarding", "--yes"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args).toMatchObject({ command: "grant", email: "admin@example.com", role: "SUPER_ADMIN", reason: "onboarding", yes: true, dryRun: false });
    }
  });

  it("rejects an unknown command", () => {
    const result = parseArgs(["delete", "admin@example.com"]);
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed email", () => {
    const result = parseArgs(["grant", "not-an-email", "--reason", "x"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not a well-formed email/);
  });

  it("rejects a missing reason", () => {
    const result = parseArgs(["grant", "admin@example.com"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/--reason is required/);
  });

  it("rejects an unrecognized flag", () => {
    const result = parseArgs(["grant", "admin@example.com", "--reason", "x", "--sudo"]);
    expect(result.ok).toBe(false);
  });

  it("lowercases and trims the email", () => {
    const result = parseArgs(["grant", "  Admin@Example.com  ", "--reason", "x"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.args.email).toBe("admin@example.com");
  });

  it("parses --dry-run and --granted-by", () => {
    const result = parseArgs(["grant", "admin@example.com", "--reason", "x", "--dry-run", "--granted-by", "boss@example.com"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.dryRun).toBe(true);
      expect(result.args.actorEmail).toBe("boss@example.com");
    }
  });
});

describe("executeCommand — grant", () => {
  it("succeeds for an exact, known user and creates an audit event (exit 0)", async () => {
    const { prisma, create, auditCreate } = makePrisma({ user: { id: "u1", email: "admin@example.com", displayName: "Admin" }, existing: null });
    const parsed = parseArgs(["grant", "admin@example.com", "--reason", "bootstrap"]);
    if (!parsed.ok) throw new Error("bad fixture");

    const result = await executeCommand(parsed.args, prisma, async () => true);

    expect(result.exitCode).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const auditArg = auditCreate.mock.calls[0][0].data;
    expect(auditArg.action).toBe("platform_access.granted");
    expect(auditArg.organizationId).toBeNull();
    // Never logs anything password/session-shaped.
    expect(JSON.stringify(auditArg)).not.toMatch(/password|passwordHash|session|cookie/i);
  });

  it("fails for an unknown user (exit 2), performs no write", async () => {
    const { prisma, create } = makePrisma({ user: null });
    const parsed = parseArgs(["grant", "ghost@example.com", "--reason", "x"]);
    if (!parsed.ok) throw new Error("bad fixture");

    const result = await executeCommand(parsed.args, prisma, async () => true);

    expect(result.exitCode).toBe(2);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a duplicate ACTIVE grant (exit 3), performs no write", async () => {
    const { prisma, create, update } = makePrisma({
      user: { id: "u1", email: "admin@example.com", displayName: null },
      existing: { id: "pa-1", status: "ACTIVE" },
    });
    const parsed = parseArgs(["grant", "admin@example.com", "--reason", "x"]);
    if (!parsed.ok) throw new Error("bad fixture");

    const result = await executeCommand(parsed.args, prisma, async () => true);

    expect(result.exitCode).toBe(3);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("re-activates a previously REVOKED grant rather than creating a duplicate row", async () => {
    const { prisma, create, update } = makePrisma({
      user: { id: "u1", email: "admin@example.com", displayName: null },
      existing: { id: "pa-1", status: "REVOKED" },
    });
    const parsed = parseArgs(["grant", "admin@example.com", "--reason", "re-onboarding"]);
    if (!parsed.ok) throw new Error("bad fixture");

    const result = await executeCommand(parsed.args, prisma, async () => true);

    expect(result.exitCode).toBe(0);
    expect(update).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it("--dry-run performs no write at all", async () => {
    const { prisma, create, update, auditCreate } = makePrisma({ user: { id: "u1", email: "admin@example.com", displayName: null }, existing: null });
    const parsed = parseArgs(["grant", "admin@example.com", "--reason", "x", "--dry-run"]);
    if (!parsed.ok) throw new Error("bad fixture");

    const result = await executeCommand(parsed.args, prisma, async () => true);

    expect(result.exitCode).toBe(0);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("without --yes, aborts (exit 4) if the confirm callback returns false, performing no write", async () => {
    const { prisma, create } = makePrisma({ user: { id: "u1", email: "admin@example.com", displayName: null }, existing: null });
    const parsed = parseArgs(["grant", "admin@example.com", "--reason", "x"]); // no --yes

    if (!parsed.ok) throw new Error("bad fixture");
    const result = await executeCommand(parsed.args, prisma, async () => false);

    expect(result.exitCode).toBe(4);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("executeCommand — revoke / suspend", () => {
  it("revoke succeeds against an ACTIVE grant (exit 0)", async () => {
    const { prisma, update, auditCreate } = makePrisma({
      user: { id: "u1", email: "admin@example.com", displayName: null },
      existing: { id: "pa-1", status: "ACTIVE" },
    });
    const parsed = parseArgs(["revoke", "admin@example.com", "--reason", "offboarding"]);
    if (!parsed.ok) throw new Error("bad fixture");

    const result = await executeCommand(parsed.args, prisma, async () => true);

    expect(result.exitCode).toBe(0);
    expect(update).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0].data.action).toBe("platform_access.revoked");
  });

  it("repeated revoke against an already-REVOKED grant is safe (exit 3, no write)", async () => {
    const { prisma, update } = makePrisma({
      user: { id: "u1", email: "admin@example.com", displayName: null },
      existing: { id: "pa-1", status: "REVOKED" },
    });
    const parsed = parseArgs(["revoke", "admin@example.com", "--reason", "offboarding"]);
    if (!parsed.ok) throw new Error("bad fixture");

    const result = await executeCommand(parsed.args, prisma, async () => true);

    expect(result.exitCode).toBe(3);
    expect(update).not.toHaveBeenCalled();
  });

  it("suspend succeeds against an ACTIVE grant and sets SUSPENDED", async () => {
    const { prisma, update } = makePrisma({
      user: { id: "u1", email: "admin@example.com", displayName: null },
      existing: { id: "pa-1", status: "ACTIVE" },
    });
    const parsed = parseArgs(["suspend", "admin@example.com", "--reason", "investigation"]);
    if (!parsed.ok) throw new Error("bad fixture");

    const result = await executeCommand(parsed.args, prisma, async () => true);

    expect(result.exitCode).toBe(0);
    expect(update.mock.calls[0][0].data.status).toBe("SUSPENDED");
  });

  it("revoking with no existing grant at all fails safely (exit 3)", async () => {
    const { prisma, update } = makePrisma({ user: { id: "u1", email: "admin@example.com", displayName: null }, existing: null });
    const parsed = parseArgs(["revoke", "admin@example.com", "--reason", "x"]);
    if (!parsed.ok) throw new Error("bad fixture");

    const result = await executeCommand(parsed.args, prisma, async () => true);

    expect(result.exitCode).toBe(3);
    expect(update).not.toHaveBeenCalled();
  });
});
