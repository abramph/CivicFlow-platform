"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { classNames, fieldClassName, fieldErrorClassName, helperTextClassName } from "@/components/forms/formStyles";
import { formatCurrency, formatEnumLabel, formatText } from "@/lib/formatting";

const categoryTypes = [
  "MEMBERSHIP",
  "DUES",
  "CONTRIBUTION",
  "EXPENDITURE",
  "EVENT",
  "CAMPAIGN",
] as const;

type CategoryType = (typeof categoryTypes)[number];

type CategoryRow = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  isActive: boolean;
  notes: string | null;
  amountDefault: string | null;
  frequency: string | null;
  standardDuesCategoryId: string | null;
  minAge: number | null;
  maxAge: number | null;
  autoAssignByAge: boolean;
  priority: number;
  effectiveDate: string | null;
  standardDuesCategory: {
    id: string;
    name: string;
  } | null;
  memberCount: number;
  duesAccountCount: number;
};

function emptyForm(initialType: CategoryType) {
  return {
    name: "",
    type: initialType,
    description: "",
    isActive: true,
    notes: "",
    amountDefault: "",
    frequency: "",
    standardDuesCategoryId: "",
    minAge: "",
    maxAge: "",
    autoAssignByAge: false,
    priority: "0",
    effectiveDate: "",
  };
}

export function CategoryManager({
  categories,
  duesCategories,
  allowedTypes = categoryTypes,
  initialType = "MEMBERSHIP",
}: {
  categories: CategoryRow[];
  duesCategories: Array<{ id: string; name: string }>;
  allowedTypes?: readonly CategoryType[];
  initialType?: CategoryType;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm(initialType));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const visibleCategories = useMemo(
    () => categories.filter((category) => allowedTypes.includes(category.type as CategoryType)),
    [allowedTypes, categories]
  );

  function setFieldValue<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function startEdit(category: CategoryRow) {
    setEditingId(category.id);
    setForm({
      name: category.name,
      type: category.type as CategoryType,
      description: category.description ?? "",
      isActive: category.isActive,
      notes: category.notes ?? "",
      amountDefault: category.amountDefault ?? "",
      frequency: category.frequency ?? "",
      standardDuesCategoryId: category.standardDuesCategoryId ?? "",
      minAge: category.minAge === null ? "" : String(category.minAge),
      maxAge: category.maxAge === null ? "" : String(category.maxAge),
      autoAssignByAge: category.autoAssignByAge,
      priority: String(category.priority),
      effectiveDate: category.effectiveDate?.slice(0, 10) ?? "",
    });
    setError(null);
    setFieldErrors({});
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm(initialType));
    setError(null);
    setFieldErrors({});
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};

    if (!form.name.trim()) {
      nextErrors.name = "Category name is required.";
    }

    if (form.amountDefault.trim() && (Number.isNaN(Number(form.amountDefault)) || Number(form.amountDefault) < 0)) {
      nextErrors.amountDefault = "Default amount must be zero or greater.";
    }
    if (form.minAge.trim() && (Number.isNaN(Number(form.minAge)) || Number(form.minAge) < 0)) {
      nextErrors.minAge = "Minimum age must be zero or greater.";
    }
    if (form.maxAge.trim() && (Number.isNaN(Number(form.maxAge)) || Number(form.maxAge) < 0)) {
      nextErrors.maxAge = "Maximum age must be zero or greater.";
    }
    if (form.minAge.trim() && form.maxAge.trim() && Number(form.minAge) > Number(form.maxAge)) {
      nextErrors.maxAge = "Maximum age must be greater than or equal to minimum age.";
    }
    if (Number.isNaN(Number(form.priority)) || Number(form.priority) < 0) {
      nextErrors.priority = "Priority must be zero or greater.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(
        editingId ? `/api/categories/${editingId}` : "/api/categories",
        {
          method: editingId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...(editingId ? {} : { type: form.type }),
            name: form.name.trim(),
            description: form.description.trim() || null,
            isActive: form.isActive,
            notes: form.notes.trim() || null,
            amountDefault: form.amountDefault.trim() ? Number(form.amountDefault) : null,
            frequency: form.frequency.trim() || null,
            standardDuesCategoryId:
              form.type === "MEMBERSHIP" ? form.standardDuesCategoryId || null : null,
            minAge: form.type === "MEMBERSHIP" && form.minAge.trim() ? Number(form.minAge) : null,
            maxAge: form.type === "MEMBERSHIP" && form.maxAge.trim() ? Number(form.maxAge) : null,
            autoAssignByAge: form.type === "MEMBERSHIP" ? form.autoAssignByAge : false,
            priority: form.type === "MEMBERSHIP" ? Number(form.priority) : 0,
            effectiveDate:
              form.type === "MEMBERSHIP" && form.effectiveDate
                ? `${form.effectiveDate}T12:00:00.000Z`
                : null,
          }),
        }
      );

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            details?: {
              fieldErrors?: Record<string, string[] | undefined>;
            };
          }
        | null;

      if (!response.ok || !payload?.ok) {
        const apiFieldErrors = payload?.details?.fieldErrors;
        if (apiFieldErrors) {
          const nextFieldErrors: Record<string, string> = {};
          for (const [field, messages] of Object.entries(apiFieldErrors)) {
            const firstMessage = messages?.[0];
            if (firstMessage) {
              nextFieldErrors[field] = firstMessage;
            }
          }
          if (Object.keys(nextFieldErrors).length > 0) {
            setFieldErrors(nextFieldErrors);
          }
        }
        setError(payload?.error || "Failed to save the category.");
        return;
      }

      router.refresh();
      resetForm();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed to save the category."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {allowedTypes.length > 1 ? (
            <label className="space-y-2 text-sm font-medium text-slate-900">
              <span>Category type</span>
              <select
                value={form.type}
                onChange={(event) => setFieldValue("type", event.target.value as CategoryType)}
                className={fieldClassName}
                disabled={Boolean(editingId)}
              >
                {allowedTypes.map((type) => (
                  <option key={type} value={type}>
                    {formatEnumLabel(type)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Category name</span>
            <input
              value={form.name}
              onChange={(event) => setFieldValue("name", event.target.value)}
              className={classNames(fieldClassName, fieldErrors.name && fieldErrorClassName)}
            />
            {fieldErrors.name ? <p className="text-sm font-medium text-red-700">{fieldErrors.name}</p> : null}
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Default amount</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amountDefault}
              onChange={(event) => setFieldValue("amountDefault", event.target.value)}
              className={classNames(fieldClassName, fieldErrors.amountDefault && fieldErrorClassName)}
            />
            {fieldErrors.amountDefault ? <p className="text-sm font-medium text-red-700">{fieldErrors.amountDefault}</p> : null}
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Frequency</span>
            <select
              value={form.frequency}
              onChange={(event) => setFieldValue("frequency", event.target.value)}
              className={fieldClassName}
            >
              <option value="">Not set</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
              <option value="one-time">One-time</option>
            </select>
          </label>

          {form.type === "MEMBERSHIP" ? (
            <label className="space-y-2 text-sm font-medium text-slate-900">
              <span>Standard dues category</span>
              <select
                value={form.standardDuesCategoryId}
                onChange={(event) => setFieldValue("standardDuesCategoryId", event.target.value)}
                className={fieldClassName}
              >
                <option value="">No linked dues category</option>
                {duesCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <p className={helperTextClassName}>Use this to map a membership category to its default dues plan.</p>
            </label>
          ) : null}

          {form.type === "MEMBERSHIP" ? (
            <>
              <label className="space-y-2 text-sm font-medium text-slate-900">
                <span>Minimum age</span>
                <input
                  type="number"
                  min="0"
                  value={form.minAge}
                  onChange={(event) => setFieldValue("minAge", event.target.value)}
                  className={classNames(fieldClassName, fieldErrors.minAge && fieldErrorClassName)}
                />
                {fieldErrors.minAge ? <p className="text-sm font-medium text-red-700">{fieldErrors.minAge}</p> : null}
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-900">
                <span>Maximum age</span>
                <input
                  type="number"
                  min="0"
                  value={form.maxAge}
                  onChange={(event) => setFieldValue("maxAge", event.target.value)}
                  className={classNames(fieldClassName, fieldErrors.maxAge && fieldErrorClassName)}
                />
                {fieldErrors.maxAge ? <p className="text-sm font-medium text-red-700">{fieldErrors.maxAge}</p> : null}
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-900">
                <span>Rule priority</span>
                <input
                  type="number"
                  min="0"
                  value={form.priority}
                  onChange={(event) => setFieldValue("priority", event.target.value)}
                  className={classNames(fieldClassName, fieldErrors.priority && fieldErrorClassName)}
                />
                {fieldErrors.priority ? <p className="text-sm font-medium text-red-700">{fieldErrors.priority}</p> : null}
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-900">
                <span>Effective date</span>
                <input
                  type="date"
                  value={form.effectiveDate}
                  onChange={(event) => setFieldValue("effectiveDate", event.target.value)}
                  className={fieldClassName}
                />
              </label>

              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900">
                <input
                  type="checkbox"
                  checked={form.autoAssignByAge}
                  onChange={(event) => setFieldValue("autoAssignByAge", event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                />
                <span>Auto-assign by age</span>
              </label>
            </>
          ) : null}

          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setFieldValue("isActive", event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
            />
            <span>Active category</span>
          </label>
        </div>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Description</span>
          <textarea
            rows={4}
            value={form.description}
            onChange={(event) => setFieldValue("description", event.target.value)}
            className={fieldClassName}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Notes</span>
          <textarea
            rows={4}
            value={form.notes}
            onChange={(event) => setFieldValue("notes", event.target.value)}
            className={fieldClassName}
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
            {saving ? "Saving..." : editingId ? "Save Category" : "Create Category"}
          </button>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Cancel Edit
            </button>
          ) : null}
        </div>
      </form>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-700">
            <tr>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Default</th>
              <th className="px-4 py-3">Linked dues</th>
              <th className="px-4 py-3">Rule</th>
              <th className="px-4 py-3">Usage</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleCategories.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-600">
                  No categories have been created for this view yet.
                </td>
              </tr>
            ) : (
              visibleCategories.map((category) => (
                <tr key={category.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-950">
                    <p className="font-semibold">{category.name}</p>
                    {category.description ? <p className="mt-1 text-xs text-slate-700">{category.description}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-900">{formatEnumLabel(category.type)}</td>
                  <td className="px-4 py-3 text-slate-900">
                    {category.amountDefault ? formatCurrency(category.amountDefault) : "—"}
                    {category.frequency ? <p className="text-xs text-slate-700">{formatEnumLabel(category.frequency)}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-900">
                    {formatText(category.standardDuesCategory?.name, "—")}
                  </td>
                  <td className="px-4 py-3 text-slate-900">
                    {category.type === "MEMBERSHIP" && category.autoAssignByAge ? (
                      <>
                        <p>
                          {category.minAge ?? "Any"}-{category.maxAge ?? "Any"} years
                        </p>
                        <p className="text-xs text-slate-700">Priority {category.priority}</p>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-900">
                    {category.memberCount} members
                    <p className="text-xs text-slate-700">{category.duesAccountCount} dues accounts</p>
                  </td>
                  <td className="px-4 py-3 text-slate-900">{category.isActive ? "Active" : "Inactive"}</td>
                  <td className="px-4 py-3 text-slate-900">
                    <button
                      type="button"
                      onClick={() => startEdit(category)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
