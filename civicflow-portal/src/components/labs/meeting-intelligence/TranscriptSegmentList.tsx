"use client";

import { useMemo, useState } from "react";

interface Segment {
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
}

export function TranscriptSegmentList({ segments, speakerLabelMap }: { segments: Segment[]; speakerLabelMap: Record<string, string> }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return segments;
    const needle = query.toLowerCase();
    return segments.filter((segment) => segment.text.toLowerCase().includes(needle));
  }, [segments, query]);

  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Search within transcript</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search text..."
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <p className="text-xs text-slate-500">{filtered.length} of {segments.length} segments shown.</p>
      <ul className="space-y-3 text-sm">
        {filtered.map((segment, index) => (
          <li key={index} className="rounded-lg border border-slate-100 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {speakerLabelMap[segment.speakerLabel] ?? segment.speakerLabel} · {(segment.startMs / 1000).toFixed(0)}s–{(segment.endMs / 1000).toFixed(0)}s
              {typeof segment.confidence === "number" ? ` · ${Math.round(segment.confidence * 100)}% confidence` : ""}
            </p>
            <p className="mt-1 text-slate-900">{segment.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
