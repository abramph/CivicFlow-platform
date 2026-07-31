"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import {
  classNames,
  fieldClassName,
  fieldErrorClassName,
  helperTextClassName,
} from "@/components/forms/formStyles";
import { VERTICAL_SELECTION_CARDS } from "@/lib/vertical-terminology";

const PAYMENT_METHOD_OPTIONS = [
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

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WIZARD_STEPS = [
  {
    id: 1 as const,
    label: "Organization",
    title: "Name your organization",
    description: "This is the identity displayed to members and administrators.",
  },
  {
    id: 2 as const,
    label: "Contact",
    title: "Contact & location",
    description: "Where members can reach you and your official mailing address.",
  },
  {
    id: 3 as const,
    label: "Members & Dues",
    title: "Members & dues setup",
    description: "Seed default categories so the portal is ready to use right away.",
  },
  {
    id: 4 as const,
    label: "Payments",
    title: "Payment methods",
    description: "Select the payment methods your organization accepts from members.",
  },
];

type Step = 1 | 2 | 3 | 4;

const defaultForm = {
  name: "",
  slug: "",
  primaryVertical: "",
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
  acceptedPaymentMethods: PAYMENT_METHOD_OPTIONS.map((m) => m.method),
};

export function OrganizationOnboardingForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState(defaultForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key as string]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key as string];
        return next;
      });
    }
  }

  function handleNameChange(name: string) {
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    setForm((prev) => ({ ...prev, name, slug }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.name;
      delete next.slug;
      return next;
    });
  }

  function validateStep1(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!form.primaryVertical) errs.primaryVertical = "Choose what type of organization you're setting up.";
    if (!form.name.trim()) errs.name = "Organization name is required.";
    if (!form.slug.trim()) errs.slug = "Slug is required.";
    else if (!/^[a-z0-9-]+$/.test(form.slug.trim()))
      errs.slug = "Only lowercase letters, numbers, and hyphens.";
    return errs;
  }

  function advance() {
    if (step === 1) {
      const errs = validateStep1();
      if (Object.keys(errs).length > 0) {
        setFieldErrors(errs);
        return;
      }
    }
    if (step < 4) {
      setStep((s) => (s + 1) as Step);
    } else {
      void submit();
    }
  }

  function skip() {
    if (step < 4) setStep((s) => (s + 1) as Step);
  }

  function back() {
    if (step > 1) setStep((s) => (s - 1) as Step);
  }

  async function submit() {
    setSaving(true);
    setServerError(null);

    try {
      const res = await fetch("/api/onboarding/organization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          slug: form.slug.trim(),
          primaryVertical: form.primaryVertical,
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
          defaultMembershipCategoryName:
            form.defaultMembershipCategoryName.trim() || null,
          defaultMembershipCategoryDescription:
            form.defaultMembershipCategoryDescription.trim() || null,
          defaultDuesCategoryName: form.defaultDuesCategoryName.trim() || null,
          defaultDuesAmount: form.defaultDuesAmount.trim()
            ? Number(form.defaultDuesAmount)
            : null,
          defaultDuesFrequency: form.defaultDuesFrequency.trim() || null,
          seniorAgeThreshold: form.seniorAgeThreshold.trim()
            ? Number(form.seniorAgeThreshold)
            : null,
          youthMaxAge: form.youthMaxAge.trim() ? Number(form.youthMaxAge) : null,
          studentMaxAge: form.studentMaxAge.trim()
            ? Number(form.studentMaxAge)
            : null,
          acceptedPaymentMethods: form.acceptedPaymentMethods,
        }),
      });

      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        details?: { fieldErrors?: Record<string, string[] | undefined> };
      } | null;

      if (!res.ok || !payload?.ok) {
        const apiFieldErrors = payload?.details?.fieldErrors;
        if (apiFieldErrors) {
          const nextFieldErrors: Record<string, string> = {};
          for (const [field, messages] of Object.entries(apiFieldErrors)) {
            if (messages?.[0]) nextFieldErrors[field] = messages[0];
          }
          if (Object.keys(nextFieldErrors).length > 0) {
            setFieldErrors(nextFieldErrors);
            const step1Fields = ["name", "slug", "organizationType", "primaryVertical"];
            if (step1Fields.some((f) => nextFieldErrors[f])) setStep(1);
          }
        }
        setServerError(payload?.error ?? "Failed to create organization.");
        setSaving(false);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setServerError("Network error. Please try again.");
      setSaving(false);
    }
  }

  const currentStepMeta = WIZARD_STEPS.find((s) => s.id === step)!;

  return (
    <div className="space-y-8">
      {/* Step indicator */}
      <nav className="flex items-start" aria-label="Setup progress">
        {WIZARD_STEPS.map((s, i) => (
          <Fragment key={s.id}>
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={classNames(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                  step > s.id
                    ? "bg-emerald-700 text-white"
                    : step === s.id
                      ? "bg-emerald-700 text-white ring-4 ring-emerald-100"
                      : "bg-slate-100 text-slate-400 ring-1 ring-slate-200"
                )}
              >
                {step > s.id ? "✓" : s.id}
              </div>
              <span
                className={classNames(
                  "whitespace-nowrap text-xs font-medium",
                  step >= s.id ? "text-emerald-700" : "text-slate-400"
                )}
              >
                {s.label}
              </span>
            </div>
            {i < WIZARD_STEPS.length - 1 && (
              <div
                className={classNames(
                  "mx-2 mt-3.5 h-px flex-1",
                  step > s.id ? "bg-emerald-600" : "bg-slate-200"
                )}
              />
            )}
          </Fragment>
        ))}
      </nav>

      {/* Step heading */}
      <div>
        <h2 className="text-lg font-semibold text-slate-950">{currentStepMeta.title}</h2>
        <p className="mt-0.5 text-sm text-slate-600">{currentStepMeta.description}</p>
      </div>

      {/* Step 1: Organization identity */}
      {step === 1 && (
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-900">
              What type of organization are you setting up? <span className="text-red-600">*</span>
            </legend>
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-required="true">
              {VERTICAL_SELECTION_CARDS.map((card) => (
                <label
                  key={card.vertical}
                  className={classNames(
                    "flex cursor-pointer flex-col gap-2 rounded-xl border px-4 py-3 text-sm transition-colors",
                    form.primaryVertical === card.vertical
                      ? "border-emerald-400 bg-emerald-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="primaryVertical"
                      value={card.vertical}
                      checked={form.primaryVertical === card.vertical}
                      onChange={() => setField("primaryVertical", card.vertical)}
                      className="h-4 w-4 border-slate-300 text-emerald-700 focus:ring-emerald-600"
                    />
                    <span className="font-semibold text-slate-950">{card.title}</span>
                  </span>
                  <span className="text-slate-600">{card.description}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {card.highlights.map((h) => (
                      <span key={h} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {h}
                      </span>
                    ))}
                  </span>
                </label>
              ))}
            </div>
            {fieldErrors.primaryVertical && (
              <p className="text-sm font-medium text-red-700">{fieldErrors.primaryVertical}</p>
            )}
          </fieldset>

          <label className="block space-y-1.5 text-sm font-medium text-slate-900">
            <span>
              Organization name <span className="text-red-600">*</span>
            </span>
            <input
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              className={classNames(fieldClassName, fieldErrors.name && fieldErrorClassName)}
              placeholder="Example Community Association"
              autoFocus
            />
            {fieldErrors.name && (
              <p className="text-sm font-medium text-red-700">{fieldErrors.name}</p>
            )}
          </label>

          <label className="block space-y-1.5 text-sm font-medium text-slate-900">
            <span>
              URL slug <span className="text-red-600">*</span>
            </span>
            <input
              value={form.slug}
              onChange={(e) => setField("slug", e.target.value.toLowerCase())}
              className={classNames(fieldClassName, fieldErrors.slug && fieldErrorClassName)}
              placeholder="example-community"
            />
            {fieldErrors.slug ? (
              <p className="text-sm font-medium text-red-700">{fieldErrors.slug}</p>
            ) : (
              <p className={helperTextClassName}>
                Auto-generated from name. Lowercase letters, numbers, and hyphens only.
              </p>
            )}
          </label>

          <label className="block space-y-1.5 text-sm font-medium text-slate-900">
            <span>Organization type</span>
            <input
              value={form.organizationType}
              onChange={(e) => setField("organizationType", e.target.value)}
              className={fieldClassName}
              placeholder="e.g. Homeowners Association, Civic Club, Nonprofit"
            />
          </label>
        </div>
      )}

      {/* Step 2: Contact & location */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm font-medium text-slate-900">
              <span>Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setField("email", e.target.value)}
                className={fieldClassName}
                placeholder="contact@yourorg.org"
              />
            </label>

            <label className="block space-y-1.5 text-sm font-medium text-slate-900">
              <span>Phone</span>
              <input
                value={form.phone}
                onChange={(e) => setField("phone", e.target.value)}
                className={fieldClassName}
                placeholder="(555) 000-0000"
              />
            </label>

            <label className="block space-y-1.5 text-sm font-medium text-slate-900 sm:col-span-2">
              <span>Website</span>
              <input
                value={form.website}
                onChange={(e) => setField("website", e.target.value)}
                className={fieldClassName}
                placeholder="https://yourorg.org"
              />
            </label>

            <label className="block space-y-1.5 text-sm font-medium text-slate-900 sm:col-span-2">
              <span>Address line 1</span>
              <input
                value={form.addressLine1}
                onChange={(e) => setField("addressLine1", e.target.value)}
                className={fieldClassName}
              />
            </label>

            <label className="block space-y-1.5 text-sm font-medium text-slate-900 sm:col-span-2">
              <span>Address line 2</span>
              <input
                value={form.addressLine2}
                onChange={(e) => setField("addressLine2", e.target.value)}
                className={fieldClassName}
              />
            </label>

            <label className="block space-y-1.5 text-sm font-medium text-slate-900">
              <span>City</span>
              <input
                value={form.city}
                onChange={(e) => setField("city", e.target.value)}
                className={fieldClassName}
              />
            </label>

            <label className="block space-y-1.5 text-sm font-medium text-slate-900">
              <span>State</span>
              <input
                value={form.state}
                onChange={(e) => setField("state", e.target.value)}
                className={fieldClassName}
              />
            </label>

            <label className="block space-y-1.5 text-sm font-medium text-slate-900">
              <span>ZIP code</span>
              <input
                value={form.zipCode}
                onChange={(e) => setField("zipCode", e.target.value)}
                className={fieldClassName}
              />
            </label>

            <label className="block space-y-1.5 text-sm font-medium text-slate-900">
              <span>Country</span>
              <input
                value={form.country}
                onChange={(e) => setField("country", e.target.value)}
                className={fieldClassName}
              />
            </label>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Regional settings
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm font-medium text-slate-900">
                <span>Timezone</span>
                <select
                  value={form.timezone}
                  onChange={(e) => setField("timezone", e.target.value)}
                  className={fieldClassName}
                >
                  <option value="America/New_York">Eastern (ET)</option>
                  <option value="America/Chicago">Central (CT)</option>
                  <option value="America/Denver">Mountain (MT)</option>
                  <option value="America/Los_Angeles">Pacific (PT)</option>
                  <option value="America/Anchorage">Alaska (AKT)</option>
                  <option value="Pacific/Honolulu">Hawaii (HT)</option>
                  <option value="UTC">UTC</option>
                </select>
              </label>

              <label className="block space-y-1.5 text-sm font-medium text-slate-900">
                <span>Fiscal year starts</span>
                <select
                  value={form.fiscalYearStart}
                  onChange={(e) => setField("fiscalYearStart", e.target.value)}
                  className={fieldClassName}
                >
                  {MONTHS.map((month, i) => (
                    <option key={i + 1} value={String(i + 1)}>
                      {month}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Members & dues */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Membership category
            </p>
            <div className="space-y-3">
              <label className="block space-y-1.5 text-sm font-medium text-slate-900">
                <span>Category name</span>
                <input
                  value={form.defaultMembershipCategoryName}
                  onChange={(e) => setField("defaultMembershipCategoryName", e.target.value)}
                  className={fieldClassName}
                  placeholder="General Member"
                />
              </label>
              <label className="block space-y-1.5 text-sm font-medium text-slate-900">
                <span>
                  Description{" "}
                  <span className="font-normal text-slate-500">(optional)</span>
                </span>
                <textarea
                  rows={2}
                  value={form.defaultMembershipCategoryDescription}
                  onChange={(e) =>
                    setField("defaultMembershipCategoryDescription", e.target.value)
                  }
                  className={fieldClassName}
                />
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Dues category
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block space-y-1.5 text-sm font-medium text-slate-900">
                <span>Category name</span>
                <input
                  value={form.defaultDuesCategoryName}
                  onChange={(e) => setField("defaultDuesCategoryName", e.target.value)}
                  className={fieldClassName}
                  placeholder="Standard Dues"
                />
              </label>
              <label className="block space-y-1.5 text-sm font-medium text-slate-900">
                <span>Default amount</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.defaultDuesAmount}
                  onChange={(e) => setField("defaultDuesAmount", e.target.value)}
                  className={classNames(
                    fieldClassName,
                    fieldErrors.defaultDuesAmount && fieldErrorClassName
                  )}
                />
                {fieldErrors.defaultDuesAmount && (
                  <p className="text-sm font-medium text-red-700">
                    {fieldErrors.defaultDuesAmount}
                  </p>
                )}
              </label>
              <label className="block space-y-1.5 text-sm font-medium text-slate-900">
                <span>Frequency</span>
                <select
                  value={form.defaultDuesFrequency}
                  onChange={(e) => setField("defaultDuesFrequency", e.target.value)}
                  className={fieldClassName}
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                  <option value="one-time">One-time</option>
                </select>
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Age-based auto-assignment
            </p>
            <p className="mb-3 mt-1 text-xs text-slate-500">
              Leave blank to skip. Creates separate membership categories for each age group.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block space-y-1.5 text-sm font-medium text-slate-900">
                <span>Senior age ≥</span>
                <input
                  type="number"
                  min="0"
                  value={form.seniorAgeThreshold}
                  onChange={(e) => setField("seniorAgeThreshold", e.target.value)}
                  className={classNames(
                    fieldClassName,
                    fieldErrors.seniorAgeThreshold && fieldErrorClassName
                  )}
                  placeholder="65"
                />
                {fieldErrors.seniorAgeThreshold && (
                  <p className="text-sm font-medium text-red-700">
                    {fieldErrors.seniorAgeThreshold}
                  </p>
                )}
              </label>
              <label className="block space-y-1.5 text-sm font-medium text-slate-900">
                <span>Youth age ≤</span>
                <input
                  type="number"
                  min="0"
                  value={form.youthMaxAge}
                  onChange={(e) => setField("youthMaxAge", e.target.value)}
                  className={classNames(
                    fieldClassName,
                    fieldErrors.youthMaxAge && fieldErrorClassName
                  )}
                  placeholder="18"
                />
                {fieldErrors.youthMaxAge && (
                  <p className="text-sm font-medium text-red-700">{fieldErrors.youthMaxAge}</p>
                )}
              </label>
              <label className="block space-y-1.5 text-sm font-medium text-slate-900">
                <span>Student age ≤</span>
                <input
                  type="number"
                  min="0"
                  value={form.studentMaxAge}
                  onChange={(e) => setField("studentMaxAge", e.target.value)}
                  className={classNames(
                    fieldClassName,
                    fieldErrors.studentMaxAge && fieldErrorClassName
                  )}
                  placeholder="25"
                />
                {fieldErrors.studentMaxAge && (
                  <p className="text-sm font-medium text-red-700">{fieldErrors.studentMaxAge}</p>
                )}
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Payment methods */}
      {step === 4 && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {PAYMENT_METHOD_OPTIONS.map((method) => (
              <label
                key={method.method}
                className={classNames(
                  "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition-colors",
                  form.acceptedPaymentMethods.includes(method.method)
                    ? "border-emerald-400 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                )}
              >
                <input
                  type="checkbox"
                  checked={form.acceptedPaymentMethods.includes(method.method)}
                  onChange={(e) => {
                    setForm((prev) => ({
                      ...prev,
                      acceptedPaymentMethods: e.target.checked
                        ? [...prev.acceptedPaymentMethods, method.method]
                        : prev.acceptedPaymentMethods.filter((m) => m !== method.method),
                    }));
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                />
                <span>{method.label}</span>
              </label>
            ))}
          </div>
          <p className={helperTextClassName}>
            You can change accepted payment methods later in Settings.
          </p>
        </div>
      )}

      {/* Server error */}
      {serverError ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {serverError}
        </div>
      ) : null}

      {/* Navigation */}
      <div className="flex items-center gap-3 border-t border-slate-100 pt-6">
        {step > 1 ? (
          <button
            type="button"
            onClick={back}
            disabled={saving}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Back
          </button>
        ) : null}

        <div className="flex-1" />

        {step > 1 && step < 4 ? (
          <button
            type="button"
            onClick={skip}
            disabled={saving}
            className="text-sm font-medium text-slate-500 hover:text-slate-700 disabled:cursor-not-allowed"
          >
            Skip this step
          </button>
        ) : null}

        <button
          type="button"
          onClick={advance}
          disabled={saving}
          className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {saving
            ? "Creating organization..."
            : step === 4
              ? "Create Organization"
              : "Continue"}
        </button>
      </div>
    </div>
  );
}
