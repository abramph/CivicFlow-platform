/**
 * Unestra Cloud — CLOUD-SEAT-D administrative seat grandfathering
 *
 * Server-only, run-once-at-launch (safely re-runnable) operator script.
 * Core logic lives in src/lib/admin-seat-grandfathering.ts (unit-tested
 * there with a mocked Prisma client) — this file is just process wiring.
 *
 * Usage:
 *   npx tsx scripts/cloud-seat-d-grandfathering.ts --dry-run
 *   npx tsx scripts/cloud-seat-d-grandfathering.ts --yes
 */
import { loadEnvConfig } from "@next/env";
import { runAdminSeatGrandfathering } from "../src/lib/admin-seat-grandfathering";

loadEnvConfig(process.cwd());

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--yes");
  if (dryRun && !args.includes("--dry-run")) {
    console.log("No --yes or --dry-run flag given — defaulting to --dry-run (no writes).\n");
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const result = await runAdminSeatGrandfathering(prisma, { dryRun });
    console.log(`Scanned ${result.organizationsScanned} organization(s).`);
    if (result.actions.length === 0) {
      console.log("No organization exceeds its new administrative-seat allowance. Nothing to grant.");
    } else {
      console.log(`${result.dryRun ? "Would grant" : "Granted"} an override to ${result.actions.length} organization(s):`);
      for (const action of result.actions) {
        console.log(
          `  - ${action.organizationName} (${action.organizationId}): used=${action.usedAdminSeats}, ` +
            `limit ${action.effectiveLimitBefore} -> override ${action.overrideBefore} -> ${action.overrideAfter}`
        );
      }
    }
    process.exit(0);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
