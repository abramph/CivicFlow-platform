"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  classNames,
  fieldClassName,
  fieldErrorClassName,
  helperTextClassName,
} from "@/components/forms/formStyles";

type MemberStatus = "active" | "inactive" | "deactivated" | "pending" | "retired" | "suspended" | "terminated";

type MemberEditFormProps = {
  member: {
    id: string;
    firstName: string;
    lastName: string;
    preferredName: string | null;
    email: string | null;
    phone: string | null;
    membershipStatus: MemberStatus;
    membershipCategoryId: string | null;
    membershipCategoryManualOverride: boolean;
    joinDate: string;
    dateOfBirth: string;
    gender: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    county: string | null;
    country: string | null;
    householdName: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    notes: string | null;
    commsSmsEnabled: boolean;
    smsOptedOutAtLabel: string | null;
  };
  membershipCategories: Array<{
    id: string;
    name: string;
  }>;
};

type SaveResponse =
  | {
      ok?: boolean;
      error?: string;
      details?: {
        fieldErrors?: Record<string, string[] | undefined>;
      };
    }
  | null;

type FieldErrors = Partial<Record<string, string>>;

function toIsoDate(value: string) {
  if (!value) return null;
  return `${value}T12:00:00.000Z`;
}

export function MemberEditForm({ member, membershipCategories }: MemberEditFormProps) {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: member.firstName,
    lastName: member.lastName,
    preferredName: member.preferredName ?? "",
    email: member.email ?? "",
    phone: member.phone ?? "",
    membershipStatus: member.membershipStatus,
    membershipCategoryId: member.membershipCategoryId ?? "",
    membershipCategoryManualOverride: member.membershipCategoryManualOverride,
    joinDate: member.joinDate,
    dateOfBirth: member.dateOfBirth,
    gender: member.gender ?? "",
    addressLine1: member.addressLine1 ?? "",
    addressLine2: member.addressLine2 ?? "",
    city: member.city ?? "",
    state: member.state ?? "",
    zipCode: member.zipCode ?? "",
    county: member.county ?? "",
    country: member.country ?? "",
    householdName: member.householdName ?? "",
    emergencyContactName: member.emergencyContactName ?? "",
    emergencyContactPhone: member.emergencyContactPhone ?? "",
    notes: member.notes ?? "",
    commsSmsEnabled: member.commsSmsEnabled,
    statusChangeReason: "",
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/members/${member.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          preferredName: form.preferredName.trim() || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          membershipStatus: form.membershipStatus,
          statusChangeReason: form.statusChangeReason.trim() || null,
          membershipCategoryId: form.membershipCategoryId || null,
          membershipCategoryManualOverride: form.membershipCategoryManualOverride,
          joinDate: toIsoDate(form.joinDate),
          dateOfBirth: toIsoDate(form.dateOfBirth),
          gender: form.gender.trim() || null,
          addressLine1: form.addressLine1.trim() || null,
          addressLine2: form.addressLine2.trim() || null,
          city: form.city.trim() || null,
          state: form.state.trim() || null,
          zipCode: form.zipCode.trim() || null,
          county: form.county.trim() || null,
          country: form.country.trim() || null,
          householdName: form.householdName.trim() || null,
          emergencyContactName: form.emergencyContactName.trim() || null,
          emergencyContactPhone: form.emergencyContactPhone.trim() || null,
          notes: form.notes.trim() || null,
          commsSmsEnabled: form.commsSmsEnabled,
        }),
      });

      const payload = (await response.json().catch(() => null)) as SaveResponse;

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

        setError(payload?.error || "Failed to update the member.");
        return;
      }

      router.push(`/members/${member.id}`);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed to update the member."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>First name</span>
          <input
            required
            className={classNames(fieldClassName, fieldErrors.firstName && fieldErrorClassName)}
            value={form.firstName}
            onChange={(event) => setFieldValue("firstName", event.target.value)}
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Last name</span>
          <input
            required
            className={classNames(fieldClassName, fieldErrors.lastName && fieldErrorClassName)}
            value={form.lastName}
            onChange={(event) => setFieldValue("lastName", event.target.value)}
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Preferred name</span>
          <input
            className={classNames(fieldClassName, fieldErrors.preferredName && fieldErrorClassName)}
            value={form.preferredName}
            onChange={(event) => setFieldValue("preferredName", event.target.value)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Email</span>
          <input
            type="email"
            className={classNames(fieldClassName, fieldErrors.email && fieldErrorClassName)}
            value={form.email}
            onChange={(event) => setFieldValue("email", event.target.value)}
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Phone</span>
          <input
            className={classNames(fieldClassName, fieldErrors.phone && fieldErrorClassName)}
            value={form.phone}
            onChange={(event) => setFieldValue("phone", event.target.value)}
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Household name</span>
          <input
            className={classNames(fieldClassName, fieldErrors.householdName && fieldErrorClassName)}
            value={form.householdName}
            onChange={(event) => setFieldValue("householdName", event.target.value)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Status</span>
          <select
            className={classNames(fieldClassName, fieldErrors.membershipStatus && fieldErrorClassName)}
            value={form.membershipStatus}
            onChange={(event) => setFieldValue("membershipStatus", event.target.value as MemberStatus)}
          >
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="inactive">Inactive</option>
            <option value="deactivated">Deactivated</option>
            <option value="retired">Retired</option>
            <option value="suspended">Suspended</option>
            <option value="terminated">Terminated</option>
          </select>
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2">
          <span>Status change reason</span>
          <input
            className={classNames(fieldClassName, fieldErrors.statusChangeReason && fieldErrorClassName)}
            value={form.statusChangeReason}
            onChange={(event) => setFieldValue("statusChangeReason", event.target.value)}
          />
          <p className={helperTextClassName}>Required for suspended, deactivated, or terminated status changes.</p>
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Membership category</span>
          <select
            className={classNames(fieldClassName, fieldErrors.membershipCategoryId && fieldErrorClassName)}
            value={form.membershipCategoryId}
            onChange={(event) => setFieldValue("membershipCategoryId", event.target.value)}
          >
            <option value="">No category assigned</option>
            {membershipCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <p className={helperTextClassName}>Membership categories are managed under Settings → Categories.</p>
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Join date</span>
          <input
            type="date"
            className={classNames(fieldClassName, fieldErrors.joinDate && fieldErrorClassName)}
            value={form.joinDate}
            onChange={(event) => setFieldValue("joinDate", event.target.value)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Date of birth</span>
          <input
            type="date"
            className={classNames(fieldClassName, fieldErrors.dateOfBirth && fieldErrorClassName)}
            value={form.dateOfBirth}
            onChange={(event) => setFieldValue("dateOfBirth", event.target.value)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Gender</span>
          <input
            className={classNames(fieldClassName, fieldErrors.gender && fieldErrorClassName)}
            value={form.gender}
            onChange={(event) => setFieldValue("gender", event.target.value)}
          />
        </label>

        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900">
          <input
            type="checkbox"
            checked={form.membershipCategoryManualOverride}
            onChange={(event) => setFieldValue("membershipCategoryManualOverride", event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
          />
          <span>Lock membership category</span>
        </label>

        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <label className="flex items-center gap-3 text-sm font-medium text-slate-900">
            <input
              type="checkbox"
              checked={form.commsSmsEnabled}
              onChange={(event) => setFieldValue("commsSmsEnabled", event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
            />
            <span>Allow SMS notifications</span>
          </label>
          <p className={helperTextClassName}>
            Only sent if the organization has the SMS add-on enabled and this member has a valid phone number.
          </p>
          {member.smsOptedOutAtLabel ? (
            <p className="text-xs font-medium text-amber-700">
              This member texted STOP on {member.smsOptedOutAtLabel} — SMS stays blocked until they text START,
              regardless of this toggle.
            </p>
          ) : null}
        </div>

        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2 xl:col-span-3">
          <span>Address line 1</span>
          <input
            className={classNames(fieldClassName, fieldErrors.addressLine1 && fieldErrorClassName)}
            value={form.addressLine1}
            onChange={(event) => setFieldValue("addressLine1", event.target.value)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2 xl:col-span-3">
          <span>Address line 2</span>
          <input
            className={classNames(fieldClassName, fieldErrors.addressLine2 && fieldErrorClassName)}
            value={form.addressLine2}
            onChange={(event) => setFieldValue("addressLine2", event.target.value)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>City</span>
          <input
            className={classNames(fieldClassName, fieldErrors.city && fieldErrorClassName)}
            value={form.city}
            onChange={(event) => setFieldValue("city", event.target.value)}
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>State</span>
          <input
            className={classNames(fieldClassName, fieldErrors.state && fieldErrorClassName)}
            value={form.state}
            onChange={(event) => setFieldValue("state", event.target.value)}
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>ZIP code</span>
          <input
            className={classNames(fieldClassName, fieldErrors.zipCode && fieldErrorClassName)}
            value={form.zipCode}
            onChange={(event) => setFieldValue("zipCode", event.target.value)}
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>County</span>
          <input
            className={classNames(fieldClassName, fieldErrors.county && fieldErrorClassName)}
            value={form.county}
            onChange={(event) => setFieldValue("county", event.target.value)}
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Country</span>
          <input
            className={classNames(fieldClassName, fieldErrors.country && fieldErrorClassName)}
            value={form.country}
            onChange={(event) => setFieldValue("country", event.target.value)}
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Emergency contact name</span>
          <input
            className={classNames(fieldClassName, fieldErrors.emergencyContactName && fieldErrorClassName)}
            value={form.emergencyContactName}
            onChange={(event) => setFieldValue("emergencyContactName", event.target.value)}
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Emergency contact phone</span>
          <input
            className={classNames(fieldClassName, fieldErrors.emergencyContactPhone && fieldErrorClassName)}
            value={form.emergencyContactPhone}
            onChange={(event) => setFieldValue("emergencyContactPhone", event.target.value)}
          />
        </label>
      </div>

      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Notes</span>
        <textarea
          className={classNames(fieldClassName, fieldErrors.notes && fieldErrorClassName)}
          rows={5}
          value={form.notes}
          onChange={(event) => setFieldValue("notes", event.target.value)}
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
          {saving ? "Saving..." : "Save member"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => router.push(`/members/${member.id}`)}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
