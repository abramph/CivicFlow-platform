import { formatDateTime } from "@/lib/formatting";

export type TimelineEntry = {
  id: string;
  title: string;
  description?: string | null;
  occurredAt: Date | string;
  eventTypeLabel: string;
};

export function Timeline({ entries, emptyMessage = "No activity recorded yet." }: { entries: TimelineEntry[]; emptyMessage?: string }) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-600">{emptyMessage}</p>;
  }
  return (
    <ol className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-950">{entry.title}</p>
          <p className="mt-1 text-xs text-slate-700">
            {entry.eventTypeLabel} &middot; {formatDateTime(entry.occurredAt)}
          </p>
          {entry.description ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{entry.description}</p> : null}
        </li>
      ))}
    </ol>
  );
}
