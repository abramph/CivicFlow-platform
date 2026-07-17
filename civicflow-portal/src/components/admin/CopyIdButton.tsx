"use client";

import { useState } from "react";

export function CopyIdButton({ id, label = "ID" }: { id: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (permissions, non-secure context) —
      // fail silently rather than throwing in an admin diagnostics widget.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-600"
      aria-label={`Copy ${label} ${id} to clipboard`}
    >
      {id}
      <span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
      <span className="sr-only">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
