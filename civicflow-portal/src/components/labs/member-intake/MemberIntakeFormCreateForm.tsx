"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PURPOSES = [
  { value: "NEW_MEMBER", label: "New member sign-up" },
  { value: "PROFILE_UPDATE", label: "Existing member profile update" },
  { value: "NEW_OR_UPDATE", label: "New or existing (let Unestra figure out which)" },
  { value: "CONTACT_UPDATE", label: "Contact info update only" },
  { value: "HOUSEHOLD_UPDATE", label: "Household update" },
  { value: "VISITOR_CONNECT", label: "Visitor / guest connect" },
  { value: "CUSTOM", label: "Custom" },
];

export function MemberIntakeFormCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("NEW_OR_UPDATE");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/member-intake/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), purpose, title: title.trim() || name.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to create this form.");
        return;
      }
      router.push(`/labs/member-intake/forms/${data.data.id}`);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Internal name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Fall Membership Drive"
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
        />
        <span className="block text-xs font-normal text-slate-500">Only your team sees this — it&apos;s for telling forms apart in this list.</span>
      </label>

      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Purpose</span>
        <select
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
        >
          {PURPOSES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Public title</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Join Our Membership"
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
        />
        <span className="block text-xs font-normal text-slate-500">Shown at the top of the public form. Defaults to the internal name if left blank.</span>
      </label>

      <button
        type="button"
        disabled={pending || !name.trim()}
        onClick={submit}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create form"}
      </button>

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
