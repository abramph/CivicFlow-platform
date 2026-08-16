"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MemberIntakeQrPanel({ formId, publicUrl, canRegenerate }: { formId: string; publicUrl: string; canRegenerate: boolean }) {
  const router = useRouter();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadQr() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/member-intake/forms/${formId}/qr`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to generate a QR code.");
        return;
      }
      setQrDataUrl(data.data.qrDataUrl);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — you can select and copy the URL manually.");
    }
  }

  async function regenerate() {
    if (!window.confirm("This immediately invalidates the current link and QR code — anyone with the old one will get a \"not found\" page. Continue?")) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/member-intake/forms/${formId}/regenerate-token`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to regenerate the link.");
        return;
      }
      setQrDataUrl(null);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-800">{publicUrl}</code>
        <button
          type="button"
          onClick={copyUrl}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
        {canRegenerate ? (
          <button
            type="button"
            disabled={pending}
            onClick={regenerate}
            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Regenerate link
          </button>
        ) : null}
      </div>

      {qrDataUrl ? (
        <div className="flex flex-col items-start gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated data: URL, not an optimizable remote asset */}
          <img src={qrDataUrl} alt="QR code for the public form" className="h-48 w-48 rounded-lg border border-slate-200" />
          <a href={qrDataUrl} download="member-form-qr.png" className="text-xs font-semibold text-emerald-700 hover:underline">
            Download PNG
          </a>
        </div>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={loadQr}
          className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {pending ? "Generating…" : "Show QR code"}
        </button>
      )}

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
