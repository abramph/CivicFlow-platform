/**
 * FEE-COVER-C: the pure processing-cost-coverage gross-up, extracted from
 * processing-cost-coverage.ts into a client-safe module (no prisma import)
 * so checkout forms can show a live estimate with the SAME math the server
 * uses, instead of hand-duplicating the formula per component (which
 * MemberGiveNow/PublicGiveForm historically did). The server remains
 * authoritative — client copies of this function only ever produce the
 * displayed estimate, never the charged amount.
 *
 * gross = ceil((net + fixed) / (1 − p)) — solves for the total charge whose
 * processor fee, once deducted, leaves exactly `netCents` for the
 * organization. Returns the COVERAGE portion only (gross − net), in integer
 * cents.
 */
export function calculateProcessingCostCoverageCents(netCents: number, percentBps: number, fixedCents: number): number {
  if (netCents <= 0) return 0;
  if (percentBps <= 0 && fixedCents <= 0) return 0;
  const p = Math.min(Math.max(percentBps, 0), 9999) / 10000;
  const gross = Math.ceil((netCents + fixedCents) / (1 - p));
  return gross - netCents;
}
