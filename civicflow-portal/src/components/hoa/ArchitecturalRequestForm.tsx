"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ArchitecturalRequestForm({
  organizationId,
  properties,
}: {
  organizationId: string;
  properties: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [proposedStartDate, setProposedStartDate] = useState("");
  const [proposedCompletionDate, setProposedCompletionDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/hoa/architectural-requests/my", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          propertyId,
          category,
          title,
          projectDescription,
          proposedStartDate: proposedStartDate ? new Date(proposedStartDate).toISOString() : null,
          proposedCompletionDate: proposedCompletionDate ? new Date(proposedCompletionDate).toISOString() : null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to create request.");
        return;
      }
      router.push(`/m/architectural-requests/${data.data.id}`);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (properties.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        You don&apos;t have an eligible ownership relationship to a property in this community. Only an owner, co-owner, or
        non-resident owner can submit an architectural request — contact the board if you believe this is incorrect.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Property</span>
        <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>

      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Category</span>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Fence, exterior paint, roof, shed, deck, landscaping, solar, driveway, windows/doors, ..."
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="A short summary of the project"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Project description</span>
        <textarea
          value={projectDescription}
          onChange={(e) => setProjectDescription(e.target.value)}
          rows={5}
          placeholder="What you're proposing, including materials, colors, dimensions, and location on the property."
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Proposed start date (optional)</span>
          <input type="date" value={proposedStartDate} onChange={(e) => setProposedStartDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Proposed completion date (optional)</span>
          <input type="date" value={proposedCompletionDate} onChange={(e) => setProposedCompletionDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      </div>

      <p className="text-sm text-slate-600">
        This creates a <strong>draft</strong> — nothing is sent to the board until you submit it from the request&apos;s own page.
      </p>

      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button
        type="button"
        disabled={pending || !propertyId || !category.trim() || !title.trim() || !projectDescription.trim()}
        onClick={submit}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save draft"}
      </button>
    </div>
  );
}
