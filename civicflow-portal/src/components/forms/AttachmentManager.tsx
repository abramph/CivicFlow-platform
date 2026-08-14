"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fieldClassName, helperTextClassName } from "@/components/forms/formStyles";
import { formatDateTime } from "@/lib/formatting";

type AttachmentRow = {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  purpose: string | null;
  memberVisible?: boolean;
  title: string | null;
  description: string | null;
  uploadedAt: string;
};

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} bytes`;
}

export function AttachmentManager({
  entityType,
  entityId,
  purpose,
  filterByPurpose = false,
  showMemberVisibility = false,
  canWrite,
  titleLabel = "File title",
}: {
  entityType: string;
  entityId: string;
  purpose?: string;
  /** List only rows matching `purpose` (PTA-D Document Center folders). Off
   * by default: single-purpose surfaces may hold legacy rows whose purpose
   * was stamped differently, and must keep showing everything. */
  filterByPurpose?: boolean;
  /** PTA-J: show the per-file "Visible to members" toggle (Document Center).
   * Off by default — most attachment surfaces are officer-only records. */
  showMemberVisibility?: boolean;
  canWrite: boolean;
  titleLabel?: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);

  async function loadRows() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ entityType, entityId });
    if (filterByPurpose && purpose) params.set("purpose", purpose);
    const response = await fetch(`/api/attachments?${params.toString()}`);
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; data?: AttachmentRow[] } | null;
    if (!response.ok || !payload?.ok) {
      setError(payload?.error ?? "Failed to load attachments.");
      setRows([]);
    } else {
      setRows(payload.data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, purpose, filterByPurpose]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    const formData = new FormData();
    formData.set("entityType", entityType);
    formData.set("entityId", entityId);
    if (purpose) formData.set("purpose", purpose);
    if (title.trim()) formData.set("title", title.trim());
    if (description.trim()) formData.set("description", description.trim());
    formData.set("file", file);

    const response = await fetch("/api/attachments", { method: "POST", body: formData });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !payload?.ok) {
      setError(payload?.error ?? "Failed to upload attachment.");
    } else {
      setTitle("");
      setDescription("");
      setFile(null);
      setMessage("Attachment uploaded.");
      await loadRows();
      router.refresh();
    }
    setSaving(false);
  }

  async function handleVisibility(id: string, memberVisible: boolean) {
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/attachments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberVisible }),
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !payload?.ok) {
      setError(payload?.error ?? "Failed to update visibility.");
    } else {
      await loadRows();
      router.refresh();
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !payload?.ok) {
      setError(payload?.error ?? "Failed to delete attachment.");
    } else {
      setMessage("Attachment removed.");
      await loadRows();
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {canWrite ? (
        <form onSubmit={handleUpload} className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>{titleLabel}</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} className={fieldClassName} />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Choose file</span>
            <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className={fieldClassName} />
            <p className={helperTextClassName}>Maximum file size is 15 MB. Files are stored privately and downloaded through signed links.</p>
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2">
            <span>Description</span>
            <textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} className={fieldClassName} />
          </label>
          <div className="md:col-span-2">
            <button type="submit" disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400">
              {saving ? "Uploading..." : "Upload Attachment"}
            </button>
          </div>
        </form>
      ) : null}

      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      {message ? <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</div> : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-700">
            <tr>
              <th className="px-4 py-3">File</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Size</th>
              <th className="px-4 py-3">Uploaded</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-600">Loading attachments...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-600">No attachments have been uploaded.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-4 py-3 text-slate-900">
                  <div className="font-medium">{row.title || row.fileName}</div>
                  {row.title ? <div className="text-xs text-slate-600">{row.fileName}</div> : null}
                  {row.description ? <div className="mt-1 text-xs text-slate-600">{row.description}</div> : null}
                </td>
                <td className="px-4 py-3 text-slate-900">{row.contentType}</td>
                <td className="px-4 py-3 text-slate-900">{formatBytes(row.byteSize)}</td>
                <td className="px-4 py-3 text-slate-900">{formatDateTime(row.uploadedAt)}</td>
                <td className="px-4 py-3 text-slate-900">
                  <div className="flex flex-wrap gap-2">
                    <a href={`/api/attachments/${row.id}/download`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50">Download</a>
                    {canWrite ? <button type="button" onClick={() => void handleDelete(row.id)} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">Remove</button> : null}
                    {showMemberVisibility && canWrite ? (
                      <label className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700">
                        <input type="checkbox" checked={row.memberVisible ?? false} onChange={(event) => void handleVisibility(row.id, event.target.checked)} className="h-3.5 w-3.5" />
                        Visible to members
                      </label>
                    ) : showMemberVisibility && row.memberVisible ? (
                      <span className="rounded-lg bg-sky-100 px-2 py-1.5 text-xs font-semibold text-sky-800">Member-visible</span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
