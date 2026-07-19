"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CONSENT_STATEMENTS } from "@/lib/labs/meeting-intelligence/consent";

export function UploadRecordingForm({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState<Record<string, boolean>>(
    Object.fromEntries(Object.keys(CONSENT_STATEMENTS).map((key) => [key, false]))
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allConsented = Object.values(consent).every(Boolean);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Please select a recording file.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const createResponse = await fetch("/api/labs/meeting-intelligence/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingId,
          originalFilename: file.name,
          mimeType: file.type,
          consent,
        }),
      });
      const createPayload = await createResponse.json().catch(() => null);
      if (!createResponse.ok || !createPayload?.ok) {
        setError(createPayload?.error || "Unable to create the job.");
        return;
      }
      const jobId = createPayload.data.id as string;

      const formData = new FormData();
      formData.append("file", file);
      const uploadResponse = await fetch(`/api/labs/meeting-intelligence/jobs/${jobId}/upload`, { method: "POST", body: formData });
      const uploadPayload = await uploadResponse.json().catch(() => null);
      if (!uploadResponse.ok || !uploadPayload?.ok) {
        setError(uploadPayload?.error || "Unable to upload the recording.");
        return;
      }

      const submitResponse = await fetch(`/api/labs/meeting-intelligence/jobs/${jobId}/submit`, { method: "POST" });
      const submitPayload = await submitResponse.json().catch(() => null);
      if (!submitResponse.ok || !submitPayload?.ok) {
        setError(submitPayload?.error || "Unable to submit the recording for processing.");
        return;
      }

      router.push(`/labs/meeting-intelligence/jobs/${jobId}`);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <label className="block space-y-2 text-sm font-medium text-slate-900">
        <span>Recording file (MP3, WAV, M4A, MP4, or WEBM)</span>
        <input
          type="file"
          accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/x-m4a,video/mp4,audio/webm,video/webm,.mp3,.wav,.m4a,.mp4,.webm"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <fieldset className="space-y-2 rounded-lg border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-900">Required confirmations</legend>
        {Object.entries(CONSENT_STATEMENTS).map(([key, statement]) => (
          <label key={key} className="flex items-start gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              className="mt-1"
              checked={consent[key] ?? false}
              onChange={(event) => setConsent((current) => ({ ...current, [key]: event.target.checked }))}
            />
            <span>{statement}</span>
          </label>
        ))}
      </fieldset>

      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

      <button
        type="submit"
        disabled={pending || !allConsented || !file}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {pending ? "Uploading..." : "Upload and Submit for Transcription"}
      </button>
    </form>
  );
}
