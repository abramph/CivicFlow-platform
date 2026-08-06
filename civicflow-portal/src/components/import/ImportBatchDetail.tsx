"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatCard } from "@/components/app/PageChrome";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ConfirmActionButton } from "@/components/labs/pta/ConfirmActionButton";

export interface ImportBatchSummary {
  status: string;
  totalRows: number;
  newCount: number;
  duplicateCount: number;
  updateCount: number;
  invalidCount: number;
  importedCount: number;
  skippedCount: number;
  blockedPlanLimitCount: number;
  planLimitSnapshot: { allowed: number; used: number; pendingAfterUpgrade: number } | null;
}

export interface FieldComparison {
  field: string;
  label: string;
  currentValue: string | null;
  incomingValue: string | null;
  differs: boolean;
}

export interface ImportRowSummary {
  id: string;
  rowNumber: number;
  normalizedData: { firstName: string; lastName: string; email: string | null };
  status: string;
  decision: string | null;
  errorMessage: string | null;
  matchedRecord: { id: string; firstName: string; lastName: string; email: string | null } | null;
  fieldComparison: FieldComparison[] | null;
}

const POLL_INTERVAL_MS = 5_000;
const POLL_WHILE_STATUSES = new Set(["ANALYZING", "IMPORTING"]);

const DECIDABLE_STATUSES = new Set(["NEW", "EXACT_DUPLICATE", "POSSIBLE_DUPLICATE", "UPDATE_AVAILABLE"]);
const MATCHABLE_STATUSES = new Set(["EXACT_DUPLICATE", "POSSIBLE_DUPLICATE", "UPDATE_AVAILABLE"]);

export function ImportBatchDetail({
  batchId,
  initialBatch,
  initialRows,
  canResume,
  canCancel,
  canReview,
  canResolveDuplicates,
}: {
  batchId: string;
  initialBatch: ImportBatchSummary;
  initialRows: ImportRowSummary[];
  canResume: boolean;
  canCancel: boolean;
  canReview: boolean;
  canResolveDuplicates: boolean;
}) {
  const router = useRouter();
  const [batch, setBatch] = useState(initialBatch);
  const [rows, setRows] = useState(initialRows);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [decidingRowId, setDecidingRowId] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [bulkSkipping, setBulkSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!POLL_WHILE_STATUSES.has(batch.status)) return;
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch(`/api/imports/${batchId}`);
        if (!response.ok) return;
        const payload = (await response.json()) as { ok: boolean; data?: { batch: ImportBatchSummary; rows: ImportRowSummary[] } };
        if (!cancelled && payload.ok && payload.data) {
          setBatch(payload.data.batch);
          setRows(payload.data.rows);
        }
      } catch {
        // Transient network error — the next poll tick will retry.
      }
    }

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [batchId, batch.status]);

  async function decide(rowId: string, decision: string) {
    setDecidingRowId(rowId);
    setError(null);
    try {
      const response = await fetch(`/api/imports/${batchId}/rows/${rowId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Could not record that decision.");
        return;
      }
      setRows((current) => current.map((row) => (row.id === rowId ? { ...row, decision } : row)));
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setDecidingRowId(null);
    }
  }

  async function startImport() {
    setStarting(true);
    setError(null);
    try {
      const response = await fetch(`/api/imports/${batchId}/start`, { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Could not start the import.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setStarting(false);
    }
  }

  async function skipExactDuplicates() {
    setBulkSkipping(true);
    setError(null);
    try {
      const response = await fetch(`/api/imports/${batchId}/skip-exact-duplicates`, { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Could not skip exact duplicates.");
        return;
      }
      setRows((current) => current.map((row) => (row.status === "EXACT_DUPLICATE" ? { ...row, decision: "SKIP" } : row)));
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setBulkSkipping(false);
    }
  }

  const filteredRows = statusFilter === "all" ? rows : rows.filter((row) => row.status === statusFilter);
  const hasExactDuplicates = rows.some((row) => row.status === "EXACT_DUPLICATE" && !row.decision);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge label={batch.status.replaceAll("_", " ")} tone={batch.status === "COMPLETED" ? "positive" : batch.status === "PAUSED_PLAN_LIMIT" || batch.status === "FAILED" ? "critical" : "caution"} />
        {batch.status === "READY_FOR_REVIEW" && canReview ? (
          <button
            type="button"
            disabled={starting}
            onClick={startImport}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {starting ? "Starting..." : "Start Import"}
          </button>
        ) : null}
        {batch.status === "READY_FOR_REVIEW" && canReview && hasExactDuplicates ? (
          <button
            type="button"
            disabled={bulkSkipping}
            onClick={skipExactDuplicates}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            {bulkSkipping ? "Skipping..." : "Skip All Exact Duplicates"}
          </button>
        ) : null}
        {batch.status === "PAUSED_PLAN_LIMIT" && canResume ? (
          <ConfirmActionButton label="Resume Import" confirmLabel="Resume" method="POST" url={`/api/imports/${batchId}/resume`} tone="neutral" />
        ) : null}
        {!["COMPLETED", "CANCELED", "FAILED"].includes(batch.status) && canCancel ? (
          <ConfirmActionButton label="Cancel Import" confirmLabel="Cancel Import" method="POST" url={`/api/imports/${batchId}/cancel`} tone="danger" />
        ) : null}
      </div>

      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

      {batch.status === "PAUSED_PLAN_LIMIT" && batch.planLimitSnapshot ? (
        <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Import paused because your organization reached its current plan limit.</p>
          <p>
            Imported: {batch.importedCount} new records · Skipped duplicates: {batch.skippedCount} · Pending after upgrade:{" "}
            {batch.planLimitSnapshot.pendingAfterUpgrade}
          </p>
          <p>
            Plan capacity: {batch.planLimitSnapshot.used} used of{" "}
            {batch.planLimitSnapshot.allowed === -1 ? "unlimited" : batch.planLimitSnapshot.allowed}.
          </p>
          <a href="/settings/billing" className="font-semibold text-emerald-700 hover:underline">
            View plan options
          </a>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total rows" value={batch.totalRows} />
        <StatCard label="New" value={batch.newCount} />
        <StatCard label="Update available" value={batch.updateCount} />
        <StatCard label="Duplicates" value={batch.duplicateCount} />
        <StatCard label="Invalid" value={batch.invalidCount} />
        <StatCard label="Imported" value={batch.importedCount} />
        <StatCard label="Skipped" value={batch.skippedCount} />
        <StatCard label="Plan-limit pending" value={batch.blockedPlanLimitCount} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="import-row-status-filter">
            Filter rows
          </label>
          <select
            id="import-row-status-filter"
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All</option>
            <option value="NEW">New</option>
            <option value="UPDATE_AVAILABLE">Update available</option>
            <option value="EXACT_DUPLICATE">Exact duplicate</option>
            <option value="POSSIBLE_DUPLICATE">Possible duplicate</option>
            <option value="INVALID">Invalid</option>
            <option value="IMPORTED">Imported</option>
            <option value="SKIPPED">Skipped</option>
            <option value="BLOCKED_PLAN_LIMIT">Plan-limit pending</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2">Row</th>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Email</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Decision</th>
                {batch.status === "READY_FOR_REVIEW" && (canReview || canResolveDuplicates) ? <th className="px-2 py-2">Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const isExpanded = expandedRowId === row.id;
                const hasMatch = MATCHABLE_STATUSES.has(row.status) && row.matchedRecord && row.fieldComparison;
                return (
                  <Fragment key={row.id}>
                    <tr className="border-t border-slate-100">
                      <td className="px-2 py-2 text-slate-600">{row.rowNumber}</td>
                      <td className="px-2 py-2 text-slate-900">
                        {row.normalizedData.firstName} {row.normalizedData.lastName}
                      </td>
                      <td className="px-2 py-2 text-slate-700">{row.normalizedData.email ?? "—"}</td>
                      <td className="px-2 py-2">
                        <StatusBadge label={row.status.replaceAll("_", " ")} tone={row.status === "INVALID" || row.status === "FAILED" ? "critical" : "neutral"} />
                        {row.errorMessage ? <p className="mt-1 text-xs text-slate-500">{row.errorMessage}</p> : null}
                        {hasMatch ? (
                          <button
                            type="button"
                            onClick={() => setExpandedRowId(isExpanded ? null : row.id)}
                            className="mt-1 block text-xs font-semibold text-emerald-700 hover:underline"
                          >
                            {isExpanded ? "Hide comparison" : "Compare with existing record"}
                          </button>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-slate-700">{row.decision ? row.decision.replaceAll("_", " ") : "—"}</td>
                      {batch.status === "READY_FOR_REVIEW" && DECIDABLE_STATUSES.has(row.status) ? (
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap gap-1">
                            {canReview && row.status === "NEW" ? (
                              <button type="button" disabled={decidingRowId === row.id} onClick={() => decide(row.id, "IMPORT_NEW")} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                                Import
                              </button>
                            ) : null}
                            {canReview ? (
                              <button type="button" disabled={decidingRowId === row.id} onClick={() => decide(row.id, "SKIP")} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                                Skip
                              </button>
                            ) : null}
                            {canResolveDuplicates && (row.status === "UPDATE_AVAILABLE" || row.status === "POSSIBLE_DUPLICATE") ? (
                              <button type="button" disabled={decidingRowId === row.id} onClick={() => decide(row.id, "UPDATE_EXISTING")} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                                Update existing
                              </button>
                            ) : null}
                            {canResolveDuplicates && row.status !== "NEW" ? (
                              <button type="button" disabled={decidingRowId === row.id} onClick={() => decide(row.id, "CREATE_ANYWAY")} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                                Create new anyway
                              </button>
                            ) : null}
                          </div>
                        </td>
                      ) : batch.status === "READY_FOR_REVIEW" ? (
                        <td className="px-2 py-2" />
                      ) : null}
                    </tr>
                    {isExpanded && hasMatch ? (
                      <tr className="border-t border-slate-100 bg-slate-50">
                        <td colSpan={6} className="px-4 py-3">
                          <p className="mb-2 text-xs font-semibold text-slate-600">
                            Matched existing record: {row.matchedRecord!.firstName} {row.matchedRecord!.lastName}
                            {row.matchedRecord!.email ? ` (${row.matchedRecord!.email})` : ""}
                          </p>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-slate-500">
                                <th className="py-1 pr-3">Field</th>
                                <th className="py-1 pr-3">Current value</th>
                                <th className="py-1 pr-3">Imported value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.fieldComparison!.map((field) => (
                                <tr key={field.field} className={field.differs ? "bg-amber-50" : undefined}>
                                  <td className="py-1 pr-3 font-medium text-slate-700">{field.label}</td>
                                  <td className="py-1 pr-3 text-slate-600">{field.currentValue ?? "—"}</td>
                                  <td className={field.differs ? "py-1 pr-3 font-semibold text-amber-800" : "py-1 pr-3 text-slate-400"}>
                                    {field.incomingValue ?? (field.differs ? "" : "(unchanged)")}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="mt-2 text-xs text-slate-500">
                            Blank imported values never overwrite existing data — only highlighted fields would change if you choose &quot;Update existing.&quot;
                          </p>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {filteredRows.length === 0 ? <p className="py-4 text-sm text-slate-600">No rows match this filter.</p> : null}
        </div>
      </div>
    </div>
  );
}
