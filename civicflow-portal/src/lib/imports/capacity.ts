import { prisma } from "@/lib/prisma";
import { checkMemberLimit } from "@/lib/plan-gate";
import type { ImportKind } from "@prisma/client";

/**
 * Resumable Import Program (PR A) — the authoritative capacity check for
 * import execution. Wraps the existing checkMemberLimit() (src/lib/plan-gate.ts)
 * rather than reimplementing plan-limit logic — this module's only job is
 * to additionally account for rows this *batch* has already committed
 * against that limit, so a long-running/paused/resumed batch never
 * over-counts or under-counts its own prior progress.
 *
 * Only COMMUNITY_MEMBERS consumes capacity in PR A — the spec is explicit
 * that "not every import type should use identical duplicate rules," and
 * the same applies to capacity: PTA households/HOA properties have their
 * own consumption rules to be defined when PR C wires those verticals.
 */
export interface ImportCapacity {
  allowed: boolean;
  /** Total current usage across the whole organization (not just this batch). */
  used: number;
  limit: number;
  /** How many more capacity-consuming rows this batch may still import right now. */
  remainingForThisBatch: number;
}

const CAPACITY_CONSUMING_KINDS: ImportKind[] = ["COMMUNITY_MEMBERS"];

export function importKindConsumesCapacity(importKind: ImportKind): boolean {
  return CAPACITY_CONSUMING_KINDS.includes(importKind);
}

export async function checkImportCapacity(organizationId: string, importKind: ImportKind): Promise<ImportCapacity> {
  if (!importKindConsumesCapacity(importKind)) {
    return { allowed: true, used: 0, limit: Infinity, remainingForThisBatch: Infinity };
  }

  const { allowed, current, limit } = await checkMemberLimit(organizationId);
  const remaining = limit === Infinity ? Infinity : Math.max(0, limit - current);
  return { allowed, used: current, limit, remainingForThisBatch: remaining };
}

/**
 * Snapshot recorded on ImportBatch.planLimitSnapshot the moment capacity is
 * exhausted mid-batch — shown verbatim on the paused-batch UI (Phase 8's
 * exact requirement: "Show the exact plan-capacity state").
 */
export interface PlanLimitSnapshot {
  allowed: number;
  used: number;
  pendingAfterUpgrade: number;
}

export async function buildPlanLimitSnapshot(
  batchId: string,
  organizationId: string,
  importKind: ImportKind
): Promise<PlanLimitSnapshot> {
  const capacity = await checkImportCapacity(organizationId, importKind);
  const pending = await prisma.importRow.count({
    where: { batchId, status: { in: ["BLOCKED_PLAN_LIMIT", "NEW", "PENDING"] } },
  });
  return {
    allowed: capacity.limit === Infinity ? -1 : capacity.limit,
    used: capacity.used,
    pendingAfterUpgrade: pending,
  };
}
