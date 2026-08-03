"use client";

import { useMemo, useState } from "react";

interface Candidate {
  userId: string;
  displayName: string | null;
  email: string;
  role: string;
}

export function ImpersonateUserPanel({ organizationId, candidates }: { organizationId: string; candidates: Candidate[] }) {
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => (c.displayName ?? "").toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.role.toLowerCase().includes(q));
  }, [candidates, query]);

  const trimmedReason = reason.trim();

  async function impersonate(targetUserId: string) {
    if (!trimmedReason) {
      setError("A reason is required to start an impersonation session.");
      return;
    }
    setPendingUserId(targetUserId);
    setError(null);
    try {
      const res = await fetch("/api/admin/impersonate/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, targetUserId, reason: trimmedReason }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to start impersonation.");
        return;
      }
      // A full navigation (not router.refresh()) so next-auth's client
      // session hook re-fetches from scratch and every component — not just
      // the ones already mounted — picks up the impersonated identity.
      window.location.assign("/dashboard");
    } finally {
      setPendingUserId(null);
    }
  }

  if (candidates.length === 0) {
    return <p className="text-sm text-slate-600">No active members to impersonate in this organization.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email, or role"
          aria-label="Search members to impersonate"
          className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required, e.g. 'member requested help with dues import')"
          aria-label="Reason for impersonating (required)"
          required
          className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-700">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.userId} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-900">{c.displayName ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{c.email}</td>
                <td className="px-3 py-2 text-slate-600">{c.role}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    disabled={pendingUserId === c.userId || !trimmedReason}
                    onClick={() => impersonate(c.userId)}
                    className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-60"
                  >
                    {pendingUserId === c.userId ? "Starting…" : "Impersonate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
