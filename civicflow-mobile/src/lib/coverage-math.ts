/**
 * MOBILE-COVER — EXACT MIRROR of civicflow-portal/src/lib/giving/coverage-math.ts.
 *
 * Portal and mobile are separate npm projects (separate Metro/Next build
 * roots) inside one repo, with no shared-package infrastructure; importing
 * across project roots would require Metro watchFolders/tsconfig surgery on
 * the eve of a release candidate. Instead this file is a byte-identical copy
 * of the exported function, and __tests__/coverage-math.test.ts asserts the
 * two sources stay identical — any drift is a CI failure, so there is still
 * exactly ONE formula.
 *
 * This client copy only ever produces the DISPLAYED estimate. The server
 * re-quotes authoritatively at checkout (§4) — nothing the app computes is
 * ever charged.
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
