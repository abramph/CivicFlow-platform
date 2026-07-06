"use client";

import { useState } from "react";

type PreviewSummary = {
  matching: number;
  eligible: number;
  alreadyLinked: number;
  noEmail: number;
  alreadyPending: number;
};

type SendSummary = {
  invited: number;
  failed: number;
  alreadyLinked: number;
  noEmail: number;
  alreadyPending: number;
  remaining: number;
};

export function BulkInviteToAppButton({ filters }: { filters: Record<string, string> }) {
  const [preview, setPreview] = useState<PreviewSummary | null>(null);
  const [result, setResult] = useState<SendSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/members/invite-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters, preview: true }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; data?: PreviewSummary } | null;
      if (!response.ok || !payload?.ok || !payload.data) {
        setError(payload?.error || "Failed to check eligible members.");
        return;
      }
      setPreview(payload.data);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmSend() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/members/invite-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters, preview: false }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; data?: SendSummary } | null;
      if (!response.ok || !payload?.ok || !payload.data) {
        setError(payload?.error || "Failed to send bulk invites.");
        return;
      }
      setResult(payload.data);
      setPreview(null);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {!preview && !result ? (
        <button
          type="button"
          onClick={loadPreview}
          disabled={loading}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          {loading ? "Checking..." : "Bulk Invite to App"}
        </button>
      ) : null}

      {preview ? (
        <div className="max-w-md rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
          <p className="font-semibold text-slate-900">
            {preview.eligible} member{preview.eligible === 1 ? "" : "s"} matching the current filters will be invited.
          </p>
          <ul className="mt-2 space-y-1 text-slate-600">
            {preview.alreadyLinked > 0 ? <li>{preview.alreadyLinked} already have app access.</li> : null}
            {preview.alreadyPending > 0 ? <li>{preview.alreadyPending} already have a pending invite.</li> : null}
            {preview.noEmail > 0 ? <li>{preview.noEmail} have no email on file.</li> : null}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={confirmSend}
              disabled={loading || preview.eligible === 0}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {loading ? "Sending..." : `Confirm & Send ${preview.eligible}`}
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              disabled={loading}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="max-w-md rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">Invited {result.invited} member{result.invited === 1 ? "" : "s"}.</p>
          {result.failed > 0 ? <p>{result.failed} failed to send — try again in a moment.</p> : null}
          {result.remaining > 0 ? (
            <p>{result.remaining} more matched but weren&apos;t sent this round — click Bulk Invite to App again to continue.</p>
          ) : null}
        </div>
      ) : null}

      {error ? <div className="max-w-md rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
    </div>
  );
}
