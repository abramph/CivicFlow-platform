"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  classNames,
  fieldClassName,
  fieldErrorClassName,
  helperTextClassName,
} from "@/components/forms/formStyles";

type OrganizationSettingsFormProps = {
  organization: {
    name: string;
    slug: string;
    organizationType: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    logoUrl: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    country: string | null;
  };
  settings: {
    timezone: string;
    currency: string;
    fiscalYearStart: number;
    emailFrom: string | null;
    customDomain: string | null;
  } | null;
};

export function OrganizationSettingsForm({
  organization,
  settings,
  canWrite,
}: OrganizationSettingsFormProps & { canWrite: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: organization.name,
    slug: organization.slug,
    organizationType: organization.organizationType ?? "",
    email: organization.email ?? "",
    phone: organization.phone ?? "",
    website: organization.website ?? "",
    logoUrl: organization.logoUrl ?? "",
    addressLine1: organization.addressLine1 ?? "",
    addressLine2: organization.addressLine2 ?? "",
    city: organization.city ?? "",
    state: organization.state ?? "",
    zipCode: organization.zipCode ?? "",
    country: organization.country ?? "USA",
    timezone: settings?.timezone ?? "America/New_York",
    currency: settings?.currency ?? "USD",
    fiscalYearStart: String(settings?.fiscalYearStart ?? 1),
    emailFrom: settings?.emailFrom ?? "",
    customDomain: settings?.customDomain ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function setFieldValue<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/organization", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: form.name.trim(),
          slug: form.slug.trim(),
          organizationType: form.organizationType.trim() || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          website: form.website.trim() || null,
          logoUrl: form.logoUrl.trim() || null,
          addressLine1: form.addressLine1.trim() || null,
          addressLine2: form.addressLine2.trim() || null,
          city: form.city.trim() || null,
          state: form.state.trim() || null,
          zipCode: form.zipCode.trim() || null,
          country: form.country.trim() || null,
          timezone: form.timezone.trim() || null,
          currency: form.currency.trim() || null,
          fiscalYearStart: Number(form.fiscalYearStart),
          emailFrom: form.emailFrom.trim() || null,
          customDomain: form.customDomain.trim() || null,
        }),
      });

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
        setError(payload?.error || "Failed to save organization settings.");
        return;
      }

      setSuccess("Organization settings saved.");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to save organization settings."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      {!canWrite ? (
        <p className="text-sm text-slate-700">You have read-only access to organization settings.</p>
      ) : null}
      <fieldset disabled={!canWrite} className="m-0 min-w-0 space-y-6 border-0 p-0">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Organization name</span>
          <input
            value={form.name}
            onChange={(event) => setFieldValue("name", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.name && fieldErrorClassName)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Slug</span>
          <input
            value={form.slug}
            onChange={(event) => setFieldValue("slug", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.slug && fieldErrorClassName)}
          />
          <p className={helperTextClassName}>Used for organization-specific SaaS routing and identity.</p>
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Organization type</span>
          <input
            value={form.organizationType}
            onChange={(event) => setFieldValue("organizationType", event.target.value)}
            className={fieldClassName}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Email</span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => setFieldValue("email", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.email && fieldErrorClassName)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Phone</span>
          <input
            value={form.phone}
            onChange={(event) => setFieldValue("phone", event.target.value)}
            className={fieldClassName}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Website</span>
          <input
            value={form.website}
            onChange={(event) => setFieldValue("website", event.target.value)}
            className={fieldClassName}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2 xl:col-span-3">
          <span>Logo URL</span>
          <input
            value={form.logoUrl}
            onChange={(event) => setFieldValue("logoUrl", event.target.value)}
            className={fieldClassName}
          />
          <p className={helperTextClassName}>Use a hosted logo URL, or upload a private logo from the organization logo section on this page.</p>
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2 xl:col-span-3">
          <span>Address line 1</span>
          <input
            value={form.addressLine1}
            onChange={(event) => setFieldValue("addressLine1", event.target.value)}
            className={fieldClassName}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2 xl:col-span-3">
          <span>Address line 2</span>
          <input
            value={form.addressLine2}
            onChange={(event) => setFieldValue("addressLine2", event.target.value)}
            className={fieldClassName}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>City</span>
          <input
            value={form.city}
            onChange={(event) => setFieldValue("city", event.target.value)}
            className={fieldClassName}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>State</span>
          <input
            value={form.state}
            onChange={(event) => setFieldValue("state", event.target.value)}
            className={fieldClassName}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>ZIP code</span>
          <input
            value={form.zipCode}
            onChange={(event) => setFieldValue("zipCode", event.target.value)}
            className={fieldClassName}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Country</span>
          <input
            value={form.country}
            onChange={(event) => setFieldValue("country", event.target.value)}
            className={fieldClassName}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Timezone</span>
          <input
            value={form.timezone}
            onChange={(event) => setFieldValue("timezone", event.target.value)}
            className={fieldClassName}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Currency</span>
          <input
            value={form.currency}
            onChange={(event) => setFieldValue("currency", event.target.value)}
            className={fieldClassName}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Fiscal year start month</span>
          <select
            value={form.fiscalYearStart}
            onChange={(event) => setFieldValue("fiscalYearStart", event.target.value)}
            className={fieldClassName}
          >
            {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2 xl:col-span-3">
          <span>Email from address</span>
          <input
            type="email"
            value={form.emailFrom}
            onChange={(event) => setFieldValue("emailFrom", event.target.value)}
            className={fieldClassName}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2 xl:col-span-3">
          <span>Custom domain</span>
          <input
            value={form.customDomain}
            onChange={(event) => setFieldValue("customDomain", event.target.value)}
            className={fieldClassName}
          />
        </label>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {saving ? "Saving..." : "Save Organization Settings"}
      </button>
      </fieldset>
    </form>
  );
}
