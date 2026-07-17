/**
 * Unestra SaaS — Platform Administrator provisioning CLI
 *
 * Server-only. No public API route exposes this, no client bundle imports
 * it, and the ordinary Users & Roles UI deliberately cannot grant platform
 * access (see UsersAndRolesManager.tsx's assignableRoleOptions). This CLI
 * is the only supported way to grant/revoke/suspend PlatformAccess.
 *
 * Core logic lives in src/lib/platform-admin-cli.ts (unit-tested there with
 * a mocked Prisma client) — this file is just process wiring: argv, stdin
 * confirmation, a real PrismaClient, and process.exit.
 *
 * Usage:
 *   npm run platform-admin:grant -- <email> --reason "..." [--role SUPER_ADMIN] [--granted-by <email>] [--yes] [--dry-run]
 *   npm run platform-admin:revoke -- <email> --reason "..." [--role SUPER_ADMIN] [--revoked-by <email>] [--yes] [--dry-run]
 *   npm run platform-admin:suspend -- <email> --reason "..." [--role SUPER_ADMIN] [--revoked-by <email>] [--yes] [--dry-run]
 *
 * Exit codes:
 *   0  success (or dry-run showed no error)
 *   1  bad input / validation failure
 *   2  user not found
 *   3  conflict (duplicate active grant, or nothing to revoke)
 *   4  aborted (declined confirmation)
 *   5  unexpected/internal error
 */

import { loadEnvConfig } from "@next/env";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import readline from "node:readline/promises";
import { parseArgs, executeCommand } from "../src/lib/platform-admin-cli";

loadEnvConfig(process.cwd());

async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`error: ${parsed.error}`);
    process.exit(1);
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma: PrismaClientType = new PrismaClient();

  try {
    const result = await executeCommand(parsed.args, prisma, () => confirm("Proceed?"));
    for (const line of result.logs) console.log(line);
    for (const line of result.errors) console.error(line);
    process.exit(result.exitCode);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err instanceof Error ? err.message : err);
  process.exit(5);
});
