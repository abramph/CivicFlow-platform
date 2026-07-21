"use client";

import { useState } from "react";

const ISSUE_CATEGORIES = [
  "transcription",
  "speaker_labels",
  "minutes_accuracy",
  "review_ux",
  "export",
  "performance",
  "reliability",
  "other",
] as const;

function RatingSelect({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="space-y-1 text-xs font-medium text-slate-700">
      <span>{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
      >
        <option value="">Not rated</option>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
    </label>
  );
}

/** Internal pilot feedback tied to one job — not a general customer-feedback platform. See docs/meeting-intelligence-pilot.md. */
export function FeedbackForm({ jobId }: { jobId: string }) {
  const [overallRating, setOverallRating] = useState<number | null>(null);
  const [transcriptionQualityRating, setTranscriptionQualityRating] = useState<number | null>(null);
  const [speakerLabelQualityRating, setSpeakerLabelQualityRating] = useState<number | null>(null);
  const [minutesAccuracyRating, setMinutesAccuracyRating] = useState<number | null>(null);
  const [timeSavedMinutes, setTimeSavedMinutes] = useState("");
  const [correctionsRequired, setCorrectionsRequired] = useState<boolean | null>(null);
  const [issueCategory, setIssueCategory] = useState("");
  const [comments, setComments] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit() {
    if (!overallRating) {
      setError("An overall rating is required.");
      return;
    }
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(`/api/labs/meeting-intelligence/jobs/${jobId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          overallRating,
          transcriptionQualityRating,
          speakerLabelQualityRating,
          minutesAccuracyRating,
          timeSavedMinutes: timeSavedMinutes ? Number(timeSavedMinutes) : null,
          correctionsRequired,
          issueCategory: issueCategory || null,
          comments: comments.trim() || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to submit feedback.");
        return;
      }
      setSuccess(true);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm text-slate-700">
        This is internal pilot feedback about how well the tool performed on this meeting — not part of the meeting record itself.
      </p>
      <div className="grid gap-3 md:grid-cols-4">
        <RatingSelect label="Overall rating (required)" value={overallRating} onChange={setOverallRating} />
        <RatingSelect label="Transcription quality" value={transcriptionQualityRating} onChange={setTranscriptionQualityRating} />
        <RatingSelect label="Speaker-label quality" value={speakerLabelQualityRating} onChange={setSpeakerLabelQualityRating} />
        <RatingSelect label="Minutes accuracy" value={minutesAccuracyRating} onChange={setMinutesAccuracyRating} />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 text-xs font-medium text-slate-700">
          <span>Time saved (minutes, estimate)</span>
          <input
            type="number"
            min={0}
            value={timeSavedMinutes}
            onChange={(e) => setTimeSavedMinutes(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-700">
          <span>Corrections required?</span>
          <select
            value={correctionsRequired == null ? "" : String(correctionsRequired)}
            onChange={(e) => setCorrectionsRequired(e.target.value === "" ? null : e.target.value === "true")}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          >
            <option value="">Not specified</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-700">
          <span>Primary issue category</span>
          <select
            value={issueCategory}
            onChange={(e) => setIssueCategory(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          >
            <option value="">None</option>
            {ISSUE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1 text-xs font-medium text-slate-700">
        <span>Comments (about the tool&apos;s output, not meeting content)</span>
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          rows={3}
          maxLength={4000}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
        />
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">Feedback submitted. Thank you.</p> : null}
      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Submitting..." : "Submit feedback"}
      </button>
    </div>
  );
}
