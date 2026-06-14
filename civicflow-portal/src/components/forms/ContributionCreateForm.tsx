"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  classNames,
  fieldClassName,
  fieldErrorClassName,
  helperTextClassName,
} from "@/components/forms/formStyles";

type MemberOption = {
  id: string;
  firstName: string;
  lastName: string;
};

type CampaignOption = {
  id: string;
  name: string;
};

type EventOption = {
  id: string;
  title: string;
};

type PaymentMethodOption = {
  method: string;
  label: string;
  instructions?: string | null;
};

type ContributionSource =
  | "MEMBER_PROFILE"
  | "CAMPAIGN_PAGE"
  | "EVENT_PAGE"
  | "MANUAL"
  | "IMPORT";

type ContributionCreateFormProps = {
  members: MemberOption[];
  campaigns: CampaignOption[];
  events: EventOption[];
  paymentMethods: PaymentMethodOption[];
  defaults?: {
    memberId?: string;
    campaignId?: string;
    eventId?: string;
  };
};

type FieldErrors = Partial<Record<string, string>>;

function formatMemberName(member: MemberOption) {
  return `${member.lastName}, ${member.firstName}`;
}

function toIsoDate(value: string) {
  if (!value) return null;
  return `${value}T12:00:00.000Z`;
}

function resolveDefaultSource(defaults?: ContributionCreateFormProps["defaults"]): ContributionSource {
  if (defaults?.campaignId) return "CAMPAIGN_PAGE";
  if (defaults?.eventId) return "EVENT_PAGE";
  if (defaults?.memberId) return "MEMBER_PROFILE";
  return "MANUAL";
}

export function ContributionCreateForm({
  members,
  campaigns,
  events,
  paymentMethods,
  defaults,
}: ContributionCreateFormProps) {
  const router = useRouter();
  const [form, setForm] = useState({
    memberId: defaults?.memberId ?? "",
    campaignId: defaults?.campaignId ?? "",
    eventId: defaults?.eventId ?? "",
    contributionDate: new Date().toISOString().slice(0, 10),
    amount: "",
    paymentMethod: "",
    source: resolveDefaultSource(defaults),
    receiptRequested: false,
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

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
    const nextErrors: FieldErrors = {};
    const amount = Number(form.amount);

    if (!form.memberId) {
      nextErrors.memberId = "Select the member who should receive credit for this contribution.";
    }

    if (!form.contributionDate) {
      nextErrors.contributionDate = "Contribution date is required.";
    }

    if (!form.amount.trim()) {
      nextErrors.amount = "Amount is required.";
    } else if (Number.isNaN(amount) || amount <= 0) {
      nextErrors.amount = "Amount must be greater than zero.";
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
      const response = await fetch("/api/contributions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          memberId: form.memberId || null,
          campaignId: form.campaignId || null,
          eventId: form.eventId || null,
          contributionDate: toIsoDate(form.contributionDate),
          amount: Number(form.amount),
          paymentMethod: form.paymentMethod || null,
          source: form.source,
          receiptRequested: form.receiptRequested,
          notes: form.notes.trim() || null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            details?: {
              fieldErrors?: Record<string, string[] | undefined>;
            };
            data?: { id?: string };
          }
        | null;

      if (!response.ok || !payload?.ok) {
        const apiFieldErrors = payload?.details?.fieldErrors;
        if (apiFieldErrors) {
          const nextFieldErrors: FieldErrors = {};
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
        setError(payload?.error || "Failed to record the contribution.");
        return;
      }

      router.push("/contributions");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to record the contribution."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-2 text-sm font-medium text-slate-900 xl:col-span-2">
          <span>Member</span>
          <select
            value={form.memberId}
            onChange={(event) => setFieldValue("memberId", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.memberId && fieldErrorClassName)}
          >
            <option value="">Select a member</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {formatMemberName(member)}
              </option>
            ))}
          </select>
          {fieldErrors.memberId ? <p className="text-sm font-medium text-red-700">{fieldErrors.memberId}</p> : null}
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Contribution date</span>
          <input
            type="date"
            value={form.contributionDate}
            onChange={(event) => setFieldValue("contributionDate", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.contributionDate && fieldErrorClassName)}
          />
          {fieldErrors.contributionDate ? (
            <p className="text-sm font-medium text-red-700">{fieldErrors.contributionDate}</p>
          ) : null}
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Campaign</span>
          <select
            value={form.campaignId}
            onChange={(event) => {
              const value = event.target.value;
              setForm((current) => ({
                ...current,
                campaignId: value,
                source: value ? "CAMPAIGN_PAGE" : current.eventId ? "EVENT_PAGE" : current.memberId ? "MEMBER_PROFILE" : "MANUAL",
              }));
            }}
            className={fieldClassName}
          >
            <option value="">No campaign attribution</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Event</span>
          <select
            value={form.eventId}
            onChange={(event) => {
              const value = event.target.value;
              setForm((current) => ({
                ...current,
                eventId: value,
                source: value ? "EVENT_PAGE" : current.campaignId ? "CAMPAIGN_PAGE" : current.memberId ? "MEMBER_PROFILE" : "MANUAL",
              }));
            }}
            className={fieldClassName}
          >
            <option value="">No event attribution</option>
            {events.map((eventItem) => (
              <option key={eventItem.id} value={eventItem.id}>
                {eventItem.title}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Amount</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={form.amount}
            onChange={(event) => setFieldValue("amount", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.amount && fieldErrorClassName)}
          />
          {fieldErrors.amount ? <p className="text-sm font-medium text-red-700">{fieldErrors.amount}</p> : null}
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Payment method</span>
          <select
            value={form.paymentMethod}
            onChange={(event) => setFieldValue("paymentMethod", event.target.value)}
            className={fieldClassName}
          >
            <option value="">Not specified</option>
            {paymentMethods.map((method) => (
              <option key={method.method} value={method.method}>
                {method.label}
              </option>
            ))}
          </select>
          {paymentMethods.find((method) => method.method === form.paymentMethod)?.instructions ? (
            <p className={helperTextClassName}>
              {paymentMethods.find((method) => method.method === form.paymentMethod)?.instructions}
            </p>
          ) : null}
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Source</span>
          <select
            value={form.source}
            onChange={(event) => setFieldValue("source", event.target.value as ContributionSource)}
            className={fieldClassName}
          >
            <option value="MEMBER_PROFILE">Member Profile</option>
            <option value="CAMPAIGN_PAGE">Campaign</option>
            <option value="EVENT_PAGE">Event</option>
            <option value="MANUAL">Manual</option>
            <option value="IMPORT">Import</option>
          </select>
          <p className={helperTextClassName}>Source controls attribution auditing in the contribution ledger.</p>
        </label>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900">
        <input
          type="checkbox"
          checked={form.receiptRequested}
          onChange={(event) => setFieldValue("receiptRequested", event.target.checked)}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
        />
        <span>
          <span className="block font-semibold">Receipt requested</span>
          <span className="block text-slate-700">
            Mark this contribution so the receipts workflow can prioritize follow-up.
          </span>
        </span>
      </label>

      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Notes</span>
        <textarea
          rows={5}
          value={form.notes}
          onChange={(event) => setFieldValue("notes", event.target.value)}
          className={classNames(fieldClassName, fieldErrors.notes && fieldErrorClassName)}
        />
      </label>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {saving ? "Recording..." : "Record Contribution"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => router.push("/contributions")}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
