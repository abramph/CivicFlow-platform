"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  PAUSED: "bg-amber-100 text-amber-800",
  ARCHIVED: "bg-slate-200 text-slate-500",
};

const NEXT_ACTIONS: Record<string, { action: "publish" | "pause" | "resume" | "archive"; label: string }[]> = {
  DRAFT: [
    { action: "publish", label: "Publish" },
    { action: "archive", label: "Archive" },
  ],
  ACTIVE: [
    { action: "pause", label: "Pause" },
    { action: "archive", label: "Archive" },
  ],
  PAUSED: [
    { action: "resume", label: "Resume" },
    { action: "archive", label: "Archive" },
  ],
  ARCHIVED: [],
};

export function MemberIntakeLifecycleActions({ formId, status, canPublish }: { formId: string; status: string; canPublish: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "publish" | "pause" | "resume" | "archive") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/member-intake/forms/${formId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to update this form's status.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const actions = NEXT_ACTIONS[status] ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${STATUS_BADGE[status] ?? "bg-slate-100 text-slate-700"}`}>
          {status}
        </span>
        {canPublish
          ? actions.map(({ action, label }) => (
              <button
                key={action}
                type="button"
                disabled={pending}
                onClick={() => act(action)}
                className={
                  action === "archive"
                    ? "rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    : "rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                }
              >
                {label}
              </button>
            ))
          : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
