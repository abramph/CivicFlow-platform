/** Clear, consistent "this is a Labs pilot" label across every PTA page — matches the InternalPilotBanner precedent from Meeting Intelligence, adapted for a vertical intended eventually for real customer use, not internal-only. */
export function PtaLabsBadge() {
  return (
    <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-3">
      <p className="text-sm font-bold uppercase tracking-wide text-emerald-900">Unestra for PTA — Labs Pilot</p>
      <p className="mt-1 text-sm text-emerald-800">
        This is a product-validation experiment, not a full school-management system. Student records here are
        intentionally minimal — no academic, health, discipline, or custody information is collected. See{" "}
        <span className="font-mono">docs/pta-labs-mvp.md</span> for scope and limitations.
      </p>
    </div>
  );
}
