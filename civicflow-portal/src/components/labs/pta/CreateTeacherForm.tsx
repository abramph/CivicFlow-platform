"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateTeacherForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/labs/pta/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email: email || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to add teacher.");
        return;
      }
      setName("");
      setEmail("");
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
        <span>Teacher name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-48 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label className="space-y-1 text-sm font-medium text-slate-900">
        <span>Email (optional)</span>
        <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <button type="button" disabled={pending || !name.trim()} onClick={submit} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
        {pending ? "Adding..." : "Add teacher"}
      </button>
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
    </div>
  );
}
