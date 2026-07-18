export function PrototypeBanner({ note }: { note?: string }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
      <p className="text-sm font-bold uppercase tracking-wide text-amber-900">Prototype — Technical Spike</p>
      <p className="mt-1 text-sm text-amber-800">
        This page is part of an internal technical spike validating Meeting Intelligence architecture. It has no
        production functionality, is visible only to APH Technologies, and every meeting shown here is synthetic
        fixture data — no customer recordings, transcripts, or real meeting content are used anywhere on this page.
        {note ? ` ${note}` : ""}
      </p>
    </div>
  );
}
