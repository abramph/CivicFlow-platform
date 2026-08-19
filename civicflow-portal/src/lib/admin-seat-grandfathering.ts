/**
 * Unestra Cloud — Administrative Seat Grandfathering (CLOUD-SEAT-D)
 *
 * Runs once before/at launch (and safely re-runnable after) to guarantee the
 * brief's core promise: enabling admin-seat enforcement must never strip an
 * existing administrator's access. For every organization whose real,
 * capability-based usedAdminSeats already exceeds its new effectiveAdminSeatLimit,
 * this grants exactly the additive `adminSeatOverride` needed to make that
 * org's limit equal to its current usage — never more, and never less than
 * whatever override the org may already have (grandfathering only ever
 * raises the override, consistent with "never reduce automatically").
 *
 * Demo/reviewer/billing-exempt/trial/internal organizations are not special
 * cased here — they go through the exact same calculation as any other org
 * (see admin-seats.ts: seat allowance is a function of vertical + override +
 * purchased seats only, never of billing state), which is what "explicitly
 * preserve" means in practice: nothing about this script can accidentally
 * skip or short-circuit them.
 *
 * Idempotent: re-running after a successful pass finds nothing left to grant
 * (every previously-affected org's override already covers its usage), and
 * running it again later after usage grows further will top up the override
 * again rather than erroring.
 */
import type { PrismaClient, Prisma } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { getAdminSeatSummary } from "@/lib/admin-seats";

const GRANDFATHERING_REASON = "Automatic launch grandfathering — existing administrative access preserved";

export interface GrandfatheringAction {
  organizationId: string;
  organizationName: string;
  usedAdminSeats: number;
  effectiveLimitBefore: number;
  overrideBefore: number;
  overrideAfter: number;
}

export interface GrandfatheringResult {
  dryRun: boolean;
  organizationsScanned: number;
  actions: GrandfatheringAction[];
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Scans every organization and grants the minimum additive override needed
 * to cover any that are already over their new effective limit. Pass
 * `dryRun: true` to compute and return exactly what WOULD change without
 * writing anything — always run dry-run first against a new environment.
 */
export async function runAdminSeatGrandfathering(db: Db, options: { dryRun: boolean }): Promise<GrandfatheringResult> {
  const orgs = await db.organization.findMany({
    select: { id: true, name: true, adminSeatOverride: true, purchasedAdminSeats: true },
  });

  const actions: GrandfatheringAction[] = [];

  for (const org of orgs) {
    const summary = await getAdminSeatSummary(org.id, db);
    if (summary.usedAdminSeats <= summary.effectiveAdminSeatLimit) continue;

    const neededOverride = summary.usedAdminSeats - summary.includedAdminSeats - summary.purchasedAdminSeats;
    const overrideAfter = Math.max(org.adminSeatOverride, neededOverride);
    if (overrideAfter <= org.adminSeatOverride) continue; // already sufficiently covered

    actions.push({
      organizationId: org.id,
      organizationName: org.name,
      usedAdminSeats: summary.usedAdminSeats,
      effectiveLimitBefore: summary.effectiveAdminSeatLimit,
      overrideBefore: org.adminSeatOverride,
      overrideAfter,
    });

    if (!options.dryRun) {
      await db.organization.update({
        where: { id: org.id },
        data: {
          adminSeatOverride: overrideAfter,
          adminSeatOverrideReason: GRANDFATHERING_REASON,
          adminSeatOverrideSetByUserId: null, // system action, not a specific platform administrator
          adminSeatOverrideSetAt: new Date(),
        },
      });
      await createAuditEvent({
        organizationId: org.id,
        actorUserId: null,
        actorEmail: "system:cloud-seat-d-grandfathering",
        action: "ADMIN_SEAT_OVERRIDE_GRANTED",
        entityType: "organization_admin_seat_override",
        entityId: org.id,
        metadata: {
          reason: GRANDFATHERING_REASON,
          before: org.adminSeatOverride,
          after: overrideAfter,
          usedAdminSeatsAtGrant: summary.usedAdminSeats,
        },
      });
    }
  }

  return { dryRun: options.dryRun, organizationsScanned: orgs.length, actions };
}
