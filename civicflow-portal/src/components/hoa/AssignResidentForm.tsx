"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type MemberOption = { id: string; firstName: string; lastName: string };

const RELATIONSHIP_TYPES: { value: string; label: string }[] = [
  { value: "OWNER", label: "Owner" },
  { value: "CO_OWNER", label: "Co-owner" },
  { value: "RESIDENT", label: "Resident (not an owner or tenant)" },
  { value: "TENANT", label: "Tenant" },
  { value: "NON_RESIDENT_OWNER", label: "Non-resident owner (owns, doesn't live here)" },
  { value: "OTHER", label: "Other" },
];

function formatMemberName(member: MemberOption) {
  return `${member.lastName}, ${member.firstName}`;
}

export function AssignResidentForm({ propertyId, members }: { propertyId: string; members: MemberOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [orgMemberId, setOrgMemberId] = useState("");
  const [relationshipType, setRelationshipType] = useState("OWNER");
  const [isPrimaryContact, setIsPrimaryContact] = useState(false);
  const [moveInDate, setMoveInDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    setConfirmation(null);
    try {
      const res = await fetch(`/api/hoa/properties/${propertyId}/residents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgMemberId,
          relationshipType,
          isPrimaryContact,
          moveInDate: moveInDate || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to link this member to the property.");
        return;
      }
      const member = members.find((m) => m.id === orgMemberId);
      setConfirmation(member ? `${formatMemberName(member)} was linked to this property.` : "Member linked to this property.");
      setOrgMemberId("");
      setRelationshipType("OWNER");
      setIsPrimaryContact(false);
      setMoveInDate("");
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
      <div className="space-y-2">
        {confirmation ? <p className="text-sm font-medium text-emerald-700">{confirmation}</p> : null}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          Link an owner or resident
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-slate-900 md:col-span-2">
          <span>Member</span>
          <select value={orgMemberId} onChange={(e) => setOrgMemberId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Select a member</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{formatMemberName(m)}</option>
            ))}
          </select>
          {members.length === 0 ? (
            <p className="text-xs text-slate-500">
              No members in this organization yet.{" "}
              <Link href="/members/new" className="font-semibold text-emerald-700 hover:underline">Add a new member first</Link>.
            </p>
          ) : null}
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Relationship</span>
          <select value={relationshipType} onChange={(e) => setRelationshipType(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {RELATIONSHIP_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Move-in date (optional)</span>
          <input type="date" value={moveInDate} onChange={(e) => setMoveInDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
        <input type="checkbox" checked={isPrimaryContact} onChange={(e) => setIsPrimaryContact(e.target.checked)} />
        <span>Set as the primary contact for this property</span>
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !orgMemberId}
          onClick={submit}
          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {pending ? "Linking..." : "Link to property"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">
          Cancel
        </button>
      </div>
    </div>
  );
}
