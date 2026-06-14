"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  classNames,
  fieldClassName,
  fieldErrorClassName,
  helperTextClassName,
} from "@/components/forms/formStyles";

const paymentMethodOptions = [
  { method: "CASH", label: "Cash" },
  { method: "CHECK", label: "Check" },
  { method: "CREDIT_CARD", label: "Credit Card" },
  { method: "DEBIT_CARD", label: "Debit Card" },
  { method: "ACH", label: "ACH" },
  { method: "ZELLE", label: "Zelle" },
  { method: "CASH_APP", label: "Cash App" },
  { method: "VENMO", label: "Venmo" },
  { method: "PAYPAL", label: "PayPal" },
  { method: "STRIPE", label: "Stripe" },
  { method: "OTHER", label: "Other" },
];

export function OrganizationOnboardingForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    slug: "",
    organizationType: "",
    email: "",
    phone: "",
    website: "",
    logoUrl: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    zipCode: "",
    country: "USA",
    timezone: "America/New_York",
    fiscalYearStart: "1",
    defaultMembershipCategoryName: "General Member",
    defaultMembershipCategoryDescription: "",
    defaultDuesCategoryName: "Standard Dues",
    defaultDuesAmount: "25.00",
    defaultDuesFrequency: "monthly",
    seniorAgeThreshold: "65",
    youthMaxAge: "",
    studentMaxAge: "",
    acceptedPaymentMethods: paymentMethodOptions.map((method) => method.method),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  function validate() {
    const nextErrors: Record<string, string> = {};

    if (!form.name.trim()) {
      nextErrors.name = "Organization name is required.";
    }
    if (!form.slug.trim()) {
      nextErrors.slug = "Slug is required.";
    } else if (!/^[a-z0-9-]+$/.test(form.slug.trim())) {
      nextErrors.slug = "Slug may only include lowercase letters, numbers, and hyphens.";
    }
    if (form.defaultDuesAmount.trim() && (Number.isNaN(Number(form.defaultDuesAmount)) || Number(form.defaultDuesAmount) < 0)) {
      nextErrors.defaultDuesAmount = "Default dues amount must be zero or greater.";
    }
    for (const key of ["seniorAgeThreshold", "youthMaxAge", "studentMaxAge"] as const) {
      if (form[key].trim() && (Number.isNaN(Number(form[key])) || Number(form[key]) < 0)) {
        nextErrors[key] = "Age threshold must be zero or greater.";
      }
    }

    return nextErrors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate();
    setFieldErrors(nextErrors);
    setError(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/onboarding/organization", {
        method: "POST",
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
          fiscalYearStart: Number(form.fiscalYearStart),
          defaultMembershipCategoryName: form.defaultMembershipCategoryName.trim() || null,
          defaultMembershipCategoryDescription: form.defaultMembershipCategoryDescription.trim() || null,
          defaultDuesCategoryName: form.defaultDuesCategoryName.trim() || null,
          defaultDuesAmount: form.defaultDuesAmount.trim() ? Number(form.defaultDuesAmount) : null,
          defaultDuesFrequency: form.defaultDuesFrequency.trim() || null,
          seniorAgeThreshold: form.seniorAgeThreshold.trim() ? Number(form.seniorAgeThreshold) : null,
          youthMaxAge: form.youthMaxAge.trim() ? Number(form.youthMaxAge) : null,
          studentMaxAge: form.studentMaxAge.trim() ? Number(form.studentMaxAge) : null,
          acceptedPaymentMethods: form.acceptedPaymentMethods,
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
        setError(payload?.error || "Failed to create the organization.");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to create the organization."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2">
          <span>Organization name</span>
          <input
            value={form.name}
            onChange={(event) => setFieldValue("name", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.name && fieldErrorClassName)}
            placeholder="Example Community Association"
          />
          {fieldErrors.name ? <p className="text-sm font-medium text-red-700">{fieldErrors.name}</p> : null}
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2">
          <span>URL slug</span>
          <input
            value={form.slug}
            onChange={(event) => setFieldValue("slug", event.target.value.toLowerCase())}
            className={classNames(fieldClassName, fieldErrors.slug && fieldErrorClassName)}
            placeholder="example-community"
          />
          {fieldErrors.slug ? <p className="text-sm font-medium text-red-700">{fieldErrors.slug}</p> : null}
          <p className={helperTextClassName}>Lowercase letters, numbers, and hyphens only.</p>
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
            className={fieldClassName}
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

        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2">
          <span>Logo URL</span>
          <input
            value={form.logoUrl}
            onChange={(event) => setFieldValue("logoUrl", event.target.value)}
            className={fieldClassName}
          />
          <p className={helperTextClassName}>If storage-backed uploads are added later, this field can be replaced without changing onboarding data requirements.</p>
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2">
          <span>Address line 1</span>
          <input
            value={form.addressLine1}
            onChange={(event) => setFieldValue("addressLine1", event.target.value)}
            className={fieldClassName}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2">
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
      </div>

      <div className="rounded-2xl border border-slate-300 bg-slate-50 p-5">
        <div className="mb-4 space-y-1">
          <h2 className="text-lg font-semibold text-slate-950">Default setup</h2>
          <p className="text-sm text-slate-700">Seed the organization with a membership category and a dues category so the portal is usable immediately after onboarding.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Default membership category</span>
            <input
              value={form.defaultMembershipCategoryName}
              onChange={(event) => setFieldValue("defaultMembershipCategoryName", event.target.value)}
              className={fieldClassName}
            />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Default dues category</span>
            <input
              value={form.defaultDuesCategoryName}
              onChange={(event) => setFieldValue("defaultDuesCategoryName", event.target.value)}
              className={fieldClassName}
            />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Default dues amount</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.defaultDuesAmount}
              onChange={(event) => setFieldValue("defaultDuesAmount", event.target.value)}
              className={classNames(fieldClassName, fieldErrors.defaultDuesAmount && fieldErrorClassName)}
            />
            {fieldErrors.defaultDuesAmount ? (
              <p className="text-sm font-medium text-red-700">{fieldErrors.defaultDuesAmount}</p>
            ) : null}
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Default dues frequency</span>
            <select
              value={form.defaultDuesFrequency}
              onChange={(event) => setFieldValue("defaultDuesFrequency", event.target.value)}
              className={fieldClassName}
            >
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
              <option value="one-time">One-time</option>
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2">
            <span>Default membership category description</span>
            <textarea
              rows={4}
              value={form.defaultMembershipCategoryDescription}
              onChange={(event) => setFieldValue("defaultMembershipCategoryDescription", event.target.value)}
              className={fieldClassName}
            />
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-300 bg-slate-50 p-5">
        <div className="mb-4 space-y-1">
          <h2 className="text-lg font-semibold text-slate-950">Auto-assignment rules</h2>
          <p className="text-sm text-slate-700">Seed membership category rules for common age-based groups.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Senior age threshold</span>
            <input
              type="number"
              min="0"
              value={form.seniorAgeThreshold}
              onChange={(event) => setFieldValue("seniorAgeThreshold", event.target.value)}
              className={classNames(fieldClassName, fieldErrors.seniorAgeThreshold && fieldErrorClassName)}
            />
            {fieldErrors.seniorAgeThreshold ? <p className="text-sm font-medium text-red-700">{fieldErrors.seniorAgeThreshold}</p> : null}
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Youth maximum age</span>
            <input
              type="number"
              min="0"
              value={form.youthMaxAge}
              onChange={(event) => setFieldValue("youthMaxAge", event.target.value)}
              className={classNames(fieldClassName, fieldErrors.youthMaxAge && fieldErrorClassName)}
            />
            {fieldErrors.youthMaxAge ? <p className="text-sm font-medium text-red-700">{fieldErrors.youthMaxAge}</p> : null}
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Student maximum age</span>
            <input
              type="number"
              min="0"
              value={form.studentMaxAge}
              onChange={(event) => setFieldValue("studentMaxAge", event.target.value)}
              className={classNames(fieldClassName, fieldErrors.studentMaxAge && fieldErrorClassName)}
            />
            {fieldErrors.studentMaxAge ? <p className="text-sm font-medium text-red-700">{fieldErrors.studentMaxAge}</p> : null}
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-300 bg-slate-50 p-5">
        <div className="mb-4 space-y-1">
          <h2 className="text-lg font-semibold text-slate-950">Payment methods</h2>
          <p className="text-sm text-slate-700">Choose the accepted methods to activate at launch.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {paymentMethodOptions.map((method) => (
            <label key={method.method} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900">
              <input
                type="checkbox"
                checked={form.acceptedPaymentMethods.includes(method.method)}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    acceptedPaymentMethods: event.target.checked
                      ? [...current.acceptedPaymentMethods, method.method]
                      : current.acceptedPaymentMethods.filter((value) => value !== method.method),
                  }));
                }}
                className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
              />
              <span>{method.label}</span>
            </label>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {saving ? "Creating organization..." : "Create Organization"}
      </button>
    </form>
  );
}
