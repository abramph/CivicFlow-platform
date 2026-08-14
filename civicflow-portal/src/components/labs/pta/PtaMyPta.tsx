"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const DOC_TYPE_LABELS: Record<string, string> = {
  BYLAWS: "Bylaws",
  STANDING_RULES: "Standing rules",
  POLICY: "Policy",
  PROCEDURE: "Procedure",
  CONFLICT_OF_INTEREST: "Conflict of interest policy",
  FINANCIAL_PROCEDURES: "Financial procedures",
  ELECTION_RULES: "Election rules",
  CODE_OF_CONDUCT: "Code of conduct",
  RESOLUTION: "Resolution",
  OTHER: "Document",
};

interface MyHandoffView {
  positionName: string;
  responsibilities: string | null;
  years: string;
  status: string;
  outgoingName: string | null;
  notes: string | null;
  checklist: { title: string; isRequired: boolean; done: boolean }[];
}

/** PTA-J — the member's "My PTA" view (§19) plus §15 self-service position
 * acceptance for incoming officers. Every download goes through the
 * dedicated linkage-gated member routes. */
export function PtaMyPta({
  contactEmail,
  documents,
  governance,
  board,
  meetings,
  myHandoff,
}: {
  contactEmail: string | null;
  documents: { id: string; label: string; folder: string | null; uploadedAt: string }[];
  governance: { id: string; title: string; docType: string; version: number; hasFile: boolean }[];
  board: { position: string; holder: string }[];
  meetings: { title: string; date: string; location: string | null }[];
  myHandoff: MyHandoffView | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acceptPosition() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/labs/pta/my/handoff", { method: "POST", headers: { "Content-Type": "application/json" } });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to accept right now.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const requiredDone = myHandoff ? myHandoff.checklist.filter((item) => item.isRequired).every((item) => item.done) : false;

  return (
    <div className="space-y-6">
      {myHandoff ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h3 className="text-sm font-semibold text-emerald-900">
            Welcome, incoming {myHandoff.positionName} ({myHandoff.years})
          </h3>
          {myHandoff.responsibilities ? <p className="mt-1 text-sm text-emerald-900">{myHandoff.responsibilities}</p> : null}
          {myHandoff.outgoingName ? (
            <p className="mt-1 text-xs text-emerald-800">Your outgoing counterpart: {myHandoff.outgoingName}</p>
          ) : null}
          {myHandoff.notes ? <p className="mt-2 whitespace-pre-wrap text-sm text-emerald-900">{myHandoff.notes}</p> : null}
          <ul className="mt-2 space-y-0.5 text-sm text-emerald-900">
            {myHandoff.checklist.map((item) => (
              <li key={item.title}>
                {item.done ? "✓" : "○"} {item.title}
                {!item.isRequired ? " (optional)" : ""}
              </li>
            ))}
          </ul>
          {myHandoff.status === "ACCEPTED" ? (
            <p className="mt-3 text-sm font-semibold text-emerald-800">You&apos;ve accepted this position — welcome aboard!</p>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={pending || !requiredDone}
                onClick={acceptPosition}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                Accept the {myHandoff.positionName} position
              </button>
              {!requiredDone ? (
                <p className="text-xs text-emerald-800">Available once the outgoing officer finishes the required handoff items.</p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Documents</h3>
          {documents.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">No shared documents yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-slate-100">
              {documents.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-sm text-slate-800">
                    {doc.label}
                    {doc.folder ? <span className="ml-2 text-xs text-slate-500">({doc.folder})</span> : null}
                  </span>
                  <a
                    href={`/api/labs/pta/my/documents/${doc.id}/download`}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50"
                  >
                    Download
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-900">Bylaws &amp; policies</h3>
          {governance.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">No governing documents published yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-slate-100">
              {governance.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-sm text-slate-800">
                    {doc.title}
                    <span className="ml-2 text-xs text-slate-500">
                      {DOC_TYPE_LABELS[doc.docType] ?? doc.docType} · v{doc.version}
                    </span>
                  </span>
                  {doc.hasFile ? (
                    <a
                      href={`/api/labs/pta/my/governance/${doc.id}/download`}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50"
                    >
                      Download
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-900">Your board</h3>
          {board.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">Board positions are being set up.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm text-slate-800">
              {board.map((row) => (
                <li key={row.position}>
                  <span className="font-medium">{row.position}:</span> {row.holder}
                </li>
              ))}
            </ul>
          )}
          {contactEmail ? (
            <a
              href={`mailto:${contactEmail}`}
              className="mt-2 inline-block rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50"
            >
              Contact the board
            </a>
          ) : null}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-900">Upcoming meetings</h3>
          {meetings.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">Nothing scheduled in the next 90 days.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm text-slate-800">
              {meetings.map((meeting) => (
                <li key={`${meeting.title}-${meeting.date}`}>
                  {new Date(meeting.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })} — {meeting.title}
                  {meeting.location ? <span className="text-xs text-slate-500"> @ {meeting.location}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
