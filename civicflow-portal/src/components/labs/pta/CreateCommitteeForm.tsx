"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateCommitteeForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/labs/pta/committees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to create committee.");
        return;
      }
      setName("");
      setDescription("");
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
        <span>Committee name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Fundraising Committee" className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label className="space-y-1 text-sm font-medium text-slate-900">
        <span>Description (optional)</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <button type="button" disabled={pending || !name.trim()} onClick={submit} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
        {pending ? "Creating..." : "Create committee"}
      </button>
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
    </div>
  );
}
