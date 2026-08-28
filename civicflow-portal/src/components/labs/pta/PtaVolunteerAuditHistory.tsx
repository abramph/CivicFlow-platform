"use client";

import { useEffect, useState } from "react";

interface AuditRow {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  actorEmail: string | null;
  after: unknown;
  createdAt: string;
}

/**
 * Volunteer Hour Requirements & Buyout program, VH-L (docs/pta-volunteer-hours.md).
 * Surfaces the existing AuditEvent trail every stage of this program has
 * been writing since VH-A, filtered to this feature's dotted action names —
 * not a second audit log, just a scoped view of the one that already
 * exists.
 */
export function PtaVolunteerAuditHistory() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // One-time load on mount, same data-fetching-effect shape as every
    // other report/summary fetch in this program.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch("/api/labs/pta/volunteer-hours/audit")
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        if (!body?.ok) {
          setError(body?.error || "Unable to load audit history.");
          return;
        }
        setRows(body.data ?? []);
      })
      .catch(() => !cancelled && setError("Unable to connect. Please try again."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="text-sm text-slate-500">Loading audit history...</p>;
  if (error)
    return (
      <p role="alert" className="text-sm font-medium text-red-700">
        {error}
      </p>
    );
  if (rows.length === 0) return <p className="text-sm text-slate-500">No volunteer-hours activity recorded yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4">When</th>
            <th className="py-2 pr-4">Action</th>
            <th className="py-2 pr-4">Resource</th>
            <th className="py-2 pr-4">Actor</th>
            <th className="py-2 pr-4">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="py-2 pr-4 whitespace-nowrap">{new Date(row.createdAt).toLocaleString()}</td>
              <td className="py-2 pr-4 font-mono text-xs">{row.action}</td>
              <td className="py-2 pr-4">
                {row.resource}
                {row.resourceId ? <span className="text-slate-400"> · {row.resourceId}</span> : null}
              </td>
              <td className="py-2 pr-4">{row.actorEmail ?? "system"}</td>
              <td className="py-2 pr-4 max-w-xs truncate text-xs text-slate-500" title={JSON.stringify(row.after)}>
                {JSON.stringify(row.after)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
