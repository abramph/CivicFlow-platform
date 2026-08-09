"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * hasPrimaryContact controls the default (not a lock) of the "set as primary
 * contact" checkbox — checked by default when the household doesn't have one
 * yet, since without a primary contact its billing OrgMember never gets an
 * email/phone (see syncHouseholdBillingContact in households.ts) and every
 * EMAIL-channel communication selector silently skips it.
 */
export function AddHouseholdAdultForm({ householdId, hasPrimaryContact }: { householdId: string; hasPrimaryContact: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [relationshipLabel, setRelationshipLabel] = useState("");
  const [makePrimaryContact, setMakePrimaryContact] = useState(!hasPrimaryContact);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/households/${householdId}/adults`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email: email || null, phone: phone || null, relationshipLabel: relationshipLabel || null, makePrimaryContact }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to add adult.");
        return;
      }
      setName("");
      setEmail("");
      setPhone("");
      setRelationshipLabel("");
      setMakePrimaryContact(false);
      setOpen(false);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50">
        Add adult
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Relationship (optional)</span>
          <input value={relationshipLabel} onChange={(e) => setRelationshipLabel(e.target.value)} placeholder="Parent, Guardian" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Email (optional)</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Phone (optional)</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
        <input type="checkbox" checked={makePrimaryContact} onChange={(e) => setMakePrimaryContact(e.target.checked)} />
        <span>Set as primary contact (used for billing and email communications)</span>
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" disabled={pending || !name.trim()} onClick={submit} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
          {pending ? "Adding..." : "Add adult"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">
          Cancel
        </button>
      </div>
    </div>
  );
}
