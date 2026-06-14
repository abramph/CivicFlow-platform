"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type CampaignFormProps = {
  mode: "create" | "edit";
  campaign?: {
    id: string;
    name: string;
    description: string | null;
    goal: string;
    startDate: string;
    endDate: string;
    status: string;
    notes: string | null;
  };
};

const fieldClassName =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

function toIsoDate(value: string) {
  if (!value) return null;
  return new Date(`${value}T00:00:00`).toISOString();
}

export function CampaignForm({ mode, campaign }: CampaignFormProps) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: campaign?.name ?? "",
    description: campaign?.description ?? "",
    goal: campaign?.goal ?? "",
    startDate: campaign?.startDate ?? "",
    endDate: campaign?.endDate ?? "",
    status: campaign?.status ?? "active",
    notes: campaign?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const trimmedGoal = form.goal.trim();
    const goalValue = trimmedGoal ? Number(trimmedGoal) : null;

    if (trimmedGoal && Number.isNaN(goalValue)) {
      setSaving(false);
      setError("Goal must be a valid number.");
      return;
    }

    const startDate = toIsoDate(form.startDate);
    const endDate = toIsoDate(form.endDate);

    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      setSaving(false);
      setError("End date must be on or after the start date.");
      return;
    }

    try {
      const response = await fetch(
        mode === "create" ? "/api/campaigns" : `/api/campaigns/${campaign?.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim() || null,
            goal: goalValue,
            startDate,
            endDate,
            status: form.status.trim() || "active",
            notes: form.notes.trim() || null,
          }),
        }
      );

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; data?: { id?: string } }
        | null;

      if (!response.ok || !payload?.ok || !payload.data?.id) {
        setError(payload?.error || "Failed to save the campaign.");
        return;
      }

      router.push(`/campaigns/${payload.data.id}`);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed to save the campaign."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2">
          <span>Campaign name</span>
          <input
            required
            className={fieldClassName}
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Goal amount</span>
          <input
            type="number"
            min="0"
            step="0.01"
            className={fieldClassName}
            value={form.goal}
            onChange={(event) => setForm((current) => ({ ...current, goal: event.target.value }))}
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Status</span>
          <input
            className={fieldClassName}
            value={form.status}
            onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Start date</span>
          <input
            type="date"
            className={fieldClassName}
            value={form.startDate}
            onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))}
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>End date</span>
          <input
            type="date"
            className={fieldClassName}
            value={form.endDate}
            onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))}
          />
        </label>
      </div>

      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Description</span>
        <textarea
          className={fieldClassName}
          rows={5}
          value={form.description}
          onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
        />
      </label>

      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Notes</span>
        <textarea
          className={fieldClassName}
          rows={4}
          value={form.notes}
          onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
        />
      </label>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {saving ? "Saving..." : mode === "create" ? "Create campaign" : "Save campaign"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => router.push(campaign?.id ? `/campaigns/${campaign.id}` : "/campaigns")}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
