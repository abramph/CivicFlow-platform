"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * A two-step inline confirmation (click → "Confirm?" / Cancel) rather than a
 * native confirm() dialog — keeps the confirmation in the page's own focus
 * order and visual language instead of a blocking browser modal. Shared by
 * every destructive/irreversible PTA officer action (deactivate household,
 * remove adult, waive dues, remove committee member, etc.).
 */
export function ConfirmActionButton({
  label,
  confirmLabel = "Confirm",
  method = "DELETE",
  url,
  body,
  tone = "danger",
  onDone,
}: {
  label: string;
  confirmLabel?: string;
  method?: "DELETE" | "POST" | "PATCH";
  url: string;
  body?: Record<string, unknown>;
  tone?: "danger" | "neutral";
  onDone?: () => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Action failed.");
        setConfirming(false);
        return;
      }
      onDone?.();
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const dangerClass = "text-red-700 hover:bg-red-50 border-red-300";
  const neutralClass = "text-slate-700 hover:bg-slate-100 border-slate-300";

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={`rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold ${tone === "danger" ? dangerClass : neutralClass}`}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
      <button
        type="button"
        disabled={pending}
        onClick={run}
        className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
      >
        {pending ? "Working..." : confirmLabel}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">
        Cancel
      </button>
    </span>
  );
}
