"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function EvaluateMemberCategoryButton({ memberId }: { memberId: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runEvaluation() {
    setRunning(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/members/${memberId}/evaluate-category`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; data?: { changed?: boolean; reason?: string } }
        | null;

      if (!response.ok || !payload?.ok) {
        setMessage(payload?.error || "Category evaluation failed.");
        return;
      }

      setMessage(payload.data?.changed ? "Category updated." : `No category change (${payload.data?.reason ?? "no match"}).`);
      router.refresh();
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={runEvaluation}
        disabled={running}
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
      >
        {running ? "Evaluating..." : "Evaluate Category"}
      </button>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
    </div>
  );
}

export function RunCategoryRulesButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runRules() {
    setRunning(true);
    setMessage(null);
    try {
      const response = await fetch("/api/categories/run-rules", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; data?: { evaluated: number; matched: number; changed: number } }
        | null;

      if (!response.ok || !payload?.ok || !payload.data) {
        setMessage(payload?.error || "Rule evaluation failed.");
        return;
      }

      setMessage(
        `Evaluated ${payload.data.evaluated} members; updated ${payload.data.changed}.`
      );
      router.refresh();
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={runRules}
        disabled={running}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {running ? "Running..." : "Run Category Rules"}
      </button>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
    </div>
  );
}

