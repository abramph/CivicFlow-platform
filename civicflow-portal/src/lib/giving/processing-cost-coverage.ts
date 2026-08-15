import { prisma } from "@/lib/prisma";

/**
 * CONNECT-F (docs/stripe-connect-architecture.md §5, §28-47) — optional
 * processing-cost coverage on GIVING only (one-time, public, recurring —
 * never dues or payment links, see the doc's §13 scope note). Contributor
 * OPT-IN only; ships OPTIONAL_CONTRIBUTOR_COVERAGE, STRIPE_SURCHARGE stays
 * reserved. No hardcoded 2.9%+30¢ anywhere — every rate is the org's own
 * configured (percentBps, fixedCents).
 */

/** Max percentage an org can configure, expressed in basis points (10% —
 * generous headroom above any real card-processing rate, but bounded so a
 * fat-fingered 10000+ (>=100%) can never make the gross-up formula divide
 * by zero or go negative). */
export const MAX_COVERAGE_PERCENT_BPS = 1000;
export const MAX_COVERAGE_FIXED_CENTS = 500;

/**
 * gross = ceil((net + fixed) / (1 − p)) — solves for the total charge whose
 * processor fee, once deducted, leaves exactly `netCents` for the
 * organization. Returns the COVERAGE portion only (gross − net), in integer
 * cents. Pure and side-effect free — the only place this math happens.
 */
export function calculateProcessingCostCoverageCents(netCents: number, percentBps: number, fixedCents: number): number {
  if (netCents <= 0) return 0;
  if (percentBps <= 0 && fixedCents <= 0) return 0;
  const p = Math.min(Math.max(percentBps, 0), 9999) / 10000;
  const gross = Math.ceil((netCents + fixedCents) / (1 - p));
  return gross - netCents;
}

export interface ProcessingCostCoverageSettings {
  mode: "OFF" | "OPTIONAL_CONTRIBUTOR_COVERAGE" | "STRIPE_SURCHARGE";
  percentBps: number;
  fixedCents: number;
}

export async function getProcessingCostCoverageSettings(organizationId: string): Promise<ProcessingCostCoverageSettings> {
  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId },
    select: { processingCostCoverageMode: true, processingCostCoveragePercentBps: true, processingCostCoverageFixedCents: true },
  });
  return {
    mode: settings?.processingCostCoverageMode ?? "OFF",
    percentBps: settings?.processingCostCoveragePercentBps ?? 0,
    fixedCents: settings?.processingCostCoverageFixedCents ?? 0,
  };
}

/**
 * Webhook-side reconciliation: session metadata carries the base/coverage
 * split SNAPSHOTTED at checkout time (never recomputed from the org's
 * current rate, which may have changed). This validates that split against
 * what Stripe actually charged, falling back to "no coverage, full amount is
 * base" when metadata is absent (legacy sessions, or coverage was never
 * offered) — the pre-CONNECT-F behavior, unchanged. Returns
 * `baseAmountCents: null` when present-but-inconsistent metadata indicates
 * tampering or staleness; callers must reject rather than record.
 */
export function resolveCoverageSplit(
  amountTotalCents: number,
  baseAmountCentsRaw: number | null | undefined,
  coverageAmountCentsRaw: number | null | undefined
): { baseAmountCents: number | null; coverageAmountCents: number } {
  if (baseAmountCentsRaw == null && coverageAmountCentsRaw == null) {
    return { baseAmountCents: amountTotalCents, coverageAmountCents: 0 };
  }
  const base = baseAmountCentsRaw ?? 0;
  const coverage = coverageAmountCentsRaw ?? 0;
  if (!Number.isInteger(base) || !Number.isInteger(coverage) || base <= 0 || coverage < 0 || base + coverage !== amountTotalCents) {
    return { baseAmountCents: null, coverageAmountCents: 0 };
  }
  return { baseAmountCents: base, coverageAmountCents: coverage };
}

/** Checkout-side quote: whether coverage can be offered right now, and what
 * it would cost for the given base amount at the org's CURRENT rate. Callers
 * must snapshot the returned `coverageCents` into session metadata (or the
 * schedule row) at the moment of charge — never re-derive it later from a
 * rate that may have since changed. */
export async function quoteProcessingCostCoverage(organizationId: string, baseCents: number) {
  const settings = await getProcessingCostCoverageSettings(organizationId);
  const offered = settings.mode === "OPTIONAL_CONTRIBUTOR_COVERAGE";
  const coverageCents = offered ? calculateProcessingCostCoverageCents(baseCents, settings.percentBps, settings.fixedCents) : 0;
  return { offered, coverageCents, totalCents: baseCents + coverageCents };
}
