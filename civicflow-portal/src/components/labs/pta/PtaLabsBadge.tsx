/**
 * Data-minimization/scope notice shown across every PTA page. As of PR #40,
 * PTA/PTO is a first-class Unestra vertical, not a Labs pilot — this banner
 * (and its component name, kept to avoid a 19-file import churn) now
 * communicates the product's real, permanent scope limitation rather than
 * "this is experimental," which is no longer true. See
 * docs/pta-access-architecture.md.
 */
export function PtaLabsBadge() {
  return (
    <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-3">
      <p className="text-sm font-bold uppercase tracking-wide text-emerald-900">Unestra for PTA</p>
      <p className="mt-1 text-sm text-emerald-800">
        Not a full school-management system. Student records here are intentionally minimal — no academic, health,
        discipline, or custody information is collected. See{" "}
        <span className="font-mono">docs/pta-access-architecture.md</span> for scope and limitations.
      </p>
    </div>
  );
}
