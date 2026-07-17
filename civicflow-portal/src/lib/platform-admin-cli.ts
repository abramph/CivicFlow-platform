/**
 * Core logic for the platform-admin provisioning CLI (scripts/platform-admin.ts).
 * Kept here, separate from the thin script wrapper, so it's unit-testable
 * with a mocked Prisma client and no process.exit()/stdin side effects.
 * Server-only — never imported by any client bundle or API route.
 */

import type { PlatformRole, PlatformAccessStatus } from "@prisma/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES: PlatformRole[] = ["SUPER_ADMIN"];

export type CliCommand = "grant" | "revoke" | "suspend";

export interface ParsedArgs {
  command: CliCommand;
  email: string;
  role: PlatformRole;
  reason: string;
  actorEmail?: string;
  yes: boolean;
  dryRun: boolean;
}

export type ParseResult = { ok: true; args: ParsedArgs } | { ok: false; error: string };

export function parseArgs(argv: string[]): ParseResult {
  const [commandRaw, emailRaw, ...rest] = argv;

  if (commandRaw !== "grant" && commandRaw !== "revoke" && commandRaw !== "suspend") {
    return { ok: false, error: `unknown command "${commandRaw ?? ""}" — expected grant | revoke | suspend` };
  }
  const command = commandRaw;

  const email = (emailRaw ?? "").trim().toLowerCase();
  if (!email) return { ok: false, error: "email is required (first positional argument)" };
  if (!EMAIL_RE.test(email)) return { ok: false, error: `"${email}" is not a well-formed email address` };

  let role: PlatformRole = "SUPER_ADMIN";
  let reason = "";
  let actorEmail: string | undefined;
  let yes = false;
  let dryRun = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    switch (arg) {
      case "--role":
        role = (rest[++i] ?? "") as PlatformRole;
        break;
      case "--reason":
        reason = rest[++i] ?? "";
        break;
      case "--granted-by":
      case "--revoked-by":
        actorEmail = (rest[++i] ?? "").trim().toLowerCase();
        break;
      case "--yes":
        yes = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      default:
        return { ok: false, error: `unrecognized argument "${arg}"` };
    }
  }

  if (!VALID_ROLES.includes(role)) {
    return { ok: false, error: `"${role}" is not a valid PlatformRole (expected one of: ${VALID_ROLES.join(", ")})` };
  }
  if (!reason.trim()) {
    return { ok: false, error: "--reason is required (a short, human-readable justification for the audit trail)" };
  }
  if (actorEmail && !EMAIL_RE.test(actorEmail)) {
    return { ok: false, error: `"${actorEmail}" (--granted-by/--revoked-by) is not a well-formed email address` };
  }

  return { ok: true, args: { command, email, role, reason: reason.trim(), actorEmail, yes, dryRun } };
}

export interface CliResult {
  exitCode: number;
  logs: string[];
  errors: string[];
}

/**
 * Minimal shape of the Prisma methods this module touches — lets tests pass
 * a lightweight mock instead of a real PrismaClient. Method-shorthand
 * syntax (not arrow-typed properties) is checked bivariantly by TS, which
 * is what lets the real, more-strictly-typed PrismaClient satisfy this
 * looser structural interface.
 */
export interface PlatformAdminPrisma {
  user: {
    findUnique(args: { where: { email: string }; select: { id: true; email: true; displayName?: true } }): Promise<{ id: string; email: string; displayName?: string | null } | null>;
  };
  platformAccess: {
    findUnique(args: { where: { userId_role: { userId: string; role: PlatformRole } } }): Promise<{ id: string; status: PlatformAccessStatus } | null>;
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<{ id: string }>;
  };
  auditEvent: {
    create(args: unknown): Promise<unknown>;
  };
}

export async function executeCommand(
  args: ParsedArgs,
  prisma: PlatformAdminPrisma,
  confirmFn: () => Promise<boolean>
): Promise<CliResult> {
  const logs: string[] = [];
  const errors: string[] = [];

  const user = await prisma.user.findUnique({
    where: { email: args.email },
    select: { id: true, email: true, displayName: true },
  });
  if (!user) {
    errors.push(`error: no user found with email "${args.email}"`);
    return { exitCode: 2, logs, errors };
  }

  const actor = args.actorEmail
    ? await prisma.user.findUnique({ where: { email: args.actorEmail }, select: { id: true, email: true } })
    : null;
  if (args.actorEmail && !actor) {
    errors.push(`error: --granted-by/--revoked-by user "${args.actorEmail}" not found`);
    return { exitCode: 2, logs, errors };
  }

  const existing = await prisma.platformAccess.findUnique({
    where: { userId_role: { userId: user.id, role: args.role } },
  });

  if (args.command === "grant") {
    if (existing && existing.status === "ACTIVE") {
      errors.push(`error: ${user.email} already has an ACTIVE ${args.role} platform grant (id: ${existing.id}) — refusing duplicate grant`);
      return { exitCode: 3, logs, errors };
    }

    logs.push(`About to grant ${args.role} platform access to ${user.email} (${user.displayName ?? "no display name"}).`);
    logs.push(`Reason: ${args.reason}`);
    if (actor) logs.push(`Granted by: ${actor.email}`);
    if (args.dryRun) {
      logs.push("--dry-run: no write performed.");
      return { exitCode: 0, logs, errors };
    }
    if (!args.yes && !(await confirmFn())) {
      logs.push("Aborted.");
      return { exitCode: 4, logs, errors };
    }

    const result = existing
      ? await prisma.platformAccess.update({
          where: { id: existing.id },
          data: { status: "ACTIVE", grantedAt: new Date(), grantedById: actor?.id ?? null, revokedAt: null, revokedById: null, reason: args.reason },
        })
      : await prisma.platformAccess.create({
          data: { userId: user.id, role: args.role, status: "ACTIVE", grantedById: actor?.id ?? null, reason: args.reason },
        });

    await prisma.auditEvent.create({
      data: {
        organizationId: null,
        actorId: actor?.id ?? null,
        actorEmail: actor?.email ?? "cli:platform-admin",
        action: "platform_access.granted",
        resource: "platform_access",
        resourceId: result.id,
        after: { userId: user.id, userEmail: user.email, role: args.role, reason: args.reason },
      },
    });

    logs.push(`Granted. PlatformAccess id: ${result.id}`);
    return { exitCode: 0, logs, errors };
  }

  // revoke / suspend share the same "must have something to act on" shape
  if (!existing || existing.status === "REVOKED") {
    errors.push(`error: ${user.email} has no active/suspended ${args.role} platform grant to ${args.command}`);
    return { exitCode: 3, logs, errors };
  }

  const newStatus: PlatformAccessStatus = args.command === "revoke" ? "REVOKED" : "SUSPENDED";
  logs.push(`About to set ${user.email}'s ${args.role} platform access to ${newStatus} (currently ${existing.status}).`);
  logs.push(`Reason: ${args.reason}`);
  if (actor) logs.push(`${args.command === "revoke" ? "Revoked" : "Suspended"} by: ${actor.email}`);
  if (args.dryRun) {
    logs.push("--dry-run: no write performed.");
    return { exitCode: 0, logs, errors };
  }
  if (!args.yes && !(await confirmFn())) {
    logs.push("Aborted.");
    return { exitCode: 4, logs, errors };
  }

  const previousStatus = existing.status;
  const updated = await prisma.platformAccess.update({
    where: { id: existing.id },
    data:
      args.command === "revoke"
        ? { status: "REVOKED", revokedAt: new Date(), revokedById: actor?.id ?? null, reason: args.reason }
        : { status: "SUSPENDED", revokedAt: new Date(), revokedById: actor?.id ?? null, reason: args.reason },
  });

  await prisma.auditEvent.create({
    data: {
      organizationId: null,
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? "cli:platform-admin",
      action: args.command === "revoke" ? "platform_access.revoked" : "platform_access.suspended",
      resource: "platform_access",
      resourceId: updated.id,
      before: { status: previousStatus },
      after: { status: newStatus, userId: user.id, userEmail: user.email, role: args.role, reason: args.reason },
    },
  });

  logs.push(`${args.command === "revoke" ? "Revoked" : "Suspended"}. PlatformAccess id: ${updated.id}`);
  return { exitCode: 0, logs, errors };
}
