"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SourceLike {
  id: string;
  name: string;
  active: boolean;
  createdAt: string | Date;
}

export function MemberIntakeSourceManager({ formId, sources, canManage }: { formId: string; sources: SourceLike[]; canManage: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrForSourceId, setQrForSourceId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  async function addSource() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/member-intake/forms/${formId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to add this source.");
        return;
      }
      setName("");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function archiveSource(sourceId: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/member-intake/forms/${formId}/sources/${sourceId}/archive`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to archive this source.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function showQr(sourceId: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/member-intake/forms/${formId}/qr?sourceId=${encodeURIComponent(sourceId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to generate a QR code.");
        return;
      }
      setQrForSourceId(sourceId);
      setQrDataUrl(data.data.qrDataUrl);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {sources.length === 0 ? (
        <p className="text-sm text-slate-600">No sources yet — the main link above works fine without them.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {sources.map((source) => (
            <li key={source.id} className="space-y-2 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-900">
                  {source.name}
                  {!source.active ? <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-500">Archived</span> : null}
                </span>
                {source.active ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => showQr(source.id)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                    >
                      QR
                    </button>
                    {canManage ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => archiveSource(source.id)}
                        className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        Archive
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {qrForSourceId === source.id && qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- generated data: URL, not an optimizable remote asset
                <img src={qrDataUrl} alt={`QR code for ${source.name}`} className="h-40 w-40 rounded-lg border border-slate-200" />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>New source name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sunday Service"
              className="block w-56 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            />
          </label>
          <button
            type="button"
            disabled={pending || !name.trim()}
            onClick={addSource}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            Add source
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
