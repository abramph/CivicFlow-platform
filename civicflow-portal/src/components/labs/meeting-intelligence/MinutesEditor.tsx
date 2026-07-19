"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StructuredMeetingMinutes } from "@/lib/labs/meeting-intelligence/minutes";

function listToText(items: string[]): string {
  return items.join("\n");
}
function textToList(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

export function MinutesEditor({
  jobId,
  draftId,
  status,
  canApprove,
  content,
}: {
  jobId: string;
  draftId: string;
  status: string;
  canApprove: boolean;
  content: StructuredMeetingMinutes;
}) {
  const router = useRouter();
  const editable = status === "DRAFT" || status === "IN_REVIEW" || status === "REJECTED";

  const [agendaText, setAgendaText] = useState(listToText(content.agendaItems));
  const [decisionsText, setDecisionsText] = useState(listToText(content.decisions));
  const [unresolvedText, setUnresolvedText] = useState(listToText(content.unresolvedIssues));
  const [nextMeeting, setNextMeeting] = useState(content.nextMeetingDetails ?? "");
  const [executiveSummary, setExecutiveSummary] = useState(content.executiveSummary ?? "");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  function buildEditableContent(): StructuredMeetingMinutes {
    return {
      ...content,
      agendaItems: textToList(agendaText),
      decisions: textToList(decisionsText),
      unresolvedIssues: textToList(unresolvedText),
      nextMeetingDetails: nextMeeting.trim() || null,
      executiveSummary: executiveSummary.trim() || null,
    };
  }

  async function callApi(path: string, key: string, method: "PATCH" | "POST", body?: Record<string, unknown>) {
    setPending(key);
    setError(null);
    try {
      const response = await fetch(`/api/labs/meeting-intelligence/jobs/${jobId}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Action failed.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
        <p className="text-sm font-semibold text-amber-900">{content.aiDisclaimer}</p>
      </div>

      <div className="space-y-3">
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Agenda (one item per line)</span>
          <textarea disabled={!editable} rows={4} value={agendaText} onChange={(e) => setAgendaText(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        </label>
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Decisions (one per line)</span>
          <textarea disabled={!editable} rows={4} value={decisionsText} onChange={(e) => setDecisionsText(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        </label>
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Unresolved issues (one per line)</span>
          <textarea disabled={!editable} rows={3} value={unresolvedText} onChange={(e) => setUnresolvedText(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        </label>
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Next meeting details</span>
          <input disabled={!editable} value={nextMeeting} onChange={(e) => setNextMeeting(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        </label>
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Executive summary</span>
          <textarea disabled={!editable} rows={3} value={executiveSummary} onChange={(e) => setExecutiveSummary(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        </label>
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-900">Motions &amp; votes</p>
        {content.motions.length === 0 ? (
          <p className="text-sm text-slate-600">No motions detected.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm text-slate-800">
            {content.motions.map((m, i) => (
              <li key={i}>{m.text} — <span className="font-semibold">{m.voteResult}</span></li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-900">Action items</p>
        {content.actionItems.length === 0 ? (
          <p className="text-sm text-slate-600">No action items detected.</p>
        ) : (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-800">
            {content.actionItems.map((a, i) => (
              <li key={i}>{a.description}{a.owner ? ` — Owner: ${a.owner}` : ""}{a.dueDate ? ` (Due: ${a.dueDate})` : ""}</li>
            ))}
          </ul>
        )}
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        {editable ? (
          <button
            type="button"
            disabled={pending === "save"}
            onClick={() => callApi("/minutes", "save", "PATCH", { editableContent: buildEditableContent() })}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            {pending === "save" ? "Saving..." : "Save Progress"}
          </button>
        ) : null}
        {status === "DRAFT" ? (
          <button
            type="button"
            disabled={pending === "review"}
            onClick={() => callApi("/minutes/review", "review", "POST")}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            {pending === "review" ? "Submitting..." : "Mark Ready for Review"}
          </button>
        ) : null}
        {status === "IN_REVIEW" && canApprove ? (
          <button
            type="button"
            disabled={pending === "approve"}
            onClick={() => callApi("/minutes/approve", "approve", "POST")}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {pending === "approve" ? "Approving..." : "Approve Minutes"}
          </button>
        ) : null}
        {status === "IN_REVIEW" ? (
          <div className="flex items-center gap-2">
            <input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason (optional)"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
            <button
              type="button"
              disabled={pending === "reject"}
              onClick={() => callApi("/minutes/reject", "reject", "POST", { reason: rejectReason || undefined })}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              {pending === "reject" ? "Rejecting..." : "Reject"}
            </button>
          </div>
        ) : null}
        {(status === "REJECTED" || status === "APPROVED") ? (
          <button
            type="button"
            disabled={pending === "regenerate"}
            onClick={() => callApi("/minutes/regenerate", "regenerate", "POST")}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            {pending === "regenerate" ? "Regenerating..." : "Regenerate Draft"}
          </button>
        ) : null}
      </div>

      <div className="flex gap-3 border-t border-slate-200 pt-4">
        <a href={`/api/labs/meeting-intelligence/jobs/${jobId}/export?format=docx`} className="text-sm font-medium text-emerald-700 hover:underline">
          Export DOCX
        </a>
        <a href={`/api/labs/meeting-intelligence/jobs/${jobId}/export?format=pdf`} className="text-sm font-medium text-emerald-700 hover:underline">
          Export PDF
        </a>
      </div>
      <p className="text-xs text-slate-400">Draft id: {draftId}</p>
    </div>
  );
}
