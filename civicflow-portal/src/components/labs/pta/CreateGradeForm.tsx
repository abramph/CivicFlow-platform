"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateGradeForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/labs/pta/grades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, sortOrder: sortOrder ? Number(sortOrder) : undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to create grade.");
        return;
      }
      setName("");
      setSortOrder("");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="space-y-1 text-sm font-medium text-slate-900">
        <span>Grade name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kindergarten" className="w-48 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label className="space-y-1 text-sm font-medium text-slate-900">
        <span>Sort order</span>
        <input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} type="number" placeholder="0" className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <button type="button" disabled={pending || !name.trim()} onClick={submit} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
        {pending ? "Adding..." : "Add grade"}
      </button>
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
    </div>
  );
}
