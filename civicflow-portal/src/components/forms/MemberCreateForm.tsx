"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  classNames,
  fieldClassName,
  fieldErrorClassName,
  helperTextClassName,
} from "@/components/forms/formStyles";

type MemberStatus = "active" | "retired" | "suspended" | "terminated";

type MembershipCategoryOption = {
  id: string;
  name: string;
};

type CreateMemberResponse =
  | {
      ok?: boolean;
      error?: string;
      details?: {
        fieldErrors?: Record<string, string[] | undefined>;
      };
      data?: {
        id?: string;
      };
    }
  | null;

type FieldErrors = Partial<
  Record<
    | "firstName"
    | "lastName"
    | "preferredName"
    | "email"
    | "phone"
    | "membershipStatus"
    | "joinDate"
    | "dateOfBirth"
    | "gender"
    | "addressLine1"
    | "addressLine2"
    | "city"
    | "state"
    | "zipCode"
    | "county"
    | "country"
    | "membershipCategoryId"
    | "householdName"
    | "emergencyContactName"
    | "emergencyContactPhone"
    | "notes",
    string
  >
>;

function toIsoDate(value: string) {
  if (!value) return null;
  return `${value}T12:00:00.000Z`;
}

export function MemberCreateForm({
  membershipCategories,
}: {
  membershipCategories: MembershipCategoryOption[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    preferredName: "",
    email: "",
    phone: "",
    membershipStatus: "active" as MemberStatus,
    membershipCategoryId: "",
    joinDate: "",
    dateOfBirth: "",
    gender: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    zipCode: "",
    county: "",
    country: "USA",
    householdName: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    notes: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function validate() {
    const nextErrors: FieldErrors = {};

    if (!form.firstName.trim()) {
      nextErrors.firstName = "First name is required.";
    }

    if (!form.lastName.trim()) {
      nextErrors.lastName = "Last name is required.";
    }

    if (form.email.trim()) {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(form.email.trim())) {
        nextErrors.email = "Enter a valid email address.";
      }
    }

    return nextErrors;
  }

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

    const nextErrors = validate();
    setFieldErrors(nextErrors);
    setError(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/members", {
        method: "POST",
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
          membershipCategoryId: form.membershipCategoryId || null,
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
        }),
      });

      const payload = (await response.json().catch(() => null)) as CreateMemberResponse;

      if (!response.ok || !payload?.ok) {
        const apiFieldErrors = payload?.details?.fieldErrors;
        if (apiFieldErrors) {
          const nextFieldErrors: FieldErrors = {};
          for (const [field, messages] of Object.entries(apiFieldErrors)) {
            const firstMessage = messages?.[0];
            if (firstMessage) {
              nextFieldErrors[field as keyof FieldErrors] = firstMessage;
            }
          }
          if (Object.keys(nextFieldErrors).length > 0) {
            setFieldErrors(nextFieldErrors);
          }
        }

        setError(payload?.error || "Failed to create the member.");
        return;
      }

      const memberId = payload.data?.id;
      router.push(memberId ? `/members/${memberId}` : "/members");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed to create the member."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit} noValidate>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>First name</span>
          <input
            required
            value={form.firstName}
            onChange={(event) => setFieldValue("firstName", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.firstName && fieldErrorClassName)}
          />
          {fieldErrors.firstName ? <p className="text-sm font-medium text-red-700">{fieldErrors.firstName}</p> : null}
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Last name</span>
          <input
            required
            value={form.lastName}
            onChange={(event) => setFieldValue("lastName", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.lastName && fieldErrorClassName)}
          />
          {fieldErrors.lastName ? <p className="text-sm font-medium text-red-700">{fieldErrors.lastName}</p> : null}
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Preferred name</span>
          <input
            value={form.preferredName}
            onChange={(event) => setFieldValue("preferredName", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.preferredName && fieldErrorClassName)}
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
          {fieldErrors.email ? <p className="text-sm font-medium text-red-700">{fieldErrors.email}</p> : null}
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Phone</span>
          <input
            value={form.phone}
            onChange={(event) => setFieldValue("phone", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.phone && fieldErrorClassName)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Household name</span>
          <input
            value={form.householdName}
            onChange={(event) => setFieldValue("householdName", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.householdName && fieldErrorClassName)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Membership status</span>
          <select
            value={form.membershipStatus}
            onChange={(event) => setFieldValue("membershipStatus", event.target.value as MemberStatus)}
            className={classNames(fieldClassName, fieldErrors.membershipStatus && fieldErrorClassName)}
          >
            <option value="active">Active</option>
            <option value="retired">Retired</option>
            <option value="suspended">Suspended</option>
            <option value="terminated">Terminated</option>
          </select>
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Membership category</span>
          <select
            value={form.membershipCategoryId}
            onChange={(event) => setFieldValue("membershipCategoryId", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.membershipCategoryId && fieldErrorClassName)}
          >
            <option value="">No category assigned</option>
            {membershipCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <p className={helperTextClassName}>Membership categories come from Settings → Categories.</p>
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Join date</span>
          <input
            type="date"
            value={form.joinDate}
            onChange={(event) => setFieldValue("joinDate", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.joinDate && fieldErrorClassName)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Date of birth</span>
          <input
            type="date"
            value={form.dateOfBirth}
            onChange={(event) => setFieldValue("dateOfBirth", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.dateOfBirth && fieldErrorClassName)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Gender</span>
          <input
            value={form.gender}
            onChange={(event) => setFieldValue("gender", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.gender && fieldErrorClassName)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2 xl:col-span-3">
          <span>Address line 1</span>
          <input
            value={form.addressLine1}
            onChange={(event) => setFieldValue("addressLine1", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.addressLine1 && fieldErrorClassName)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2 xl:col-span-3">
          <span>Address line 2</span>
          <input
            value={form.addressLine2}
            onChange={(event) => setFieldValue("addressLine2", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.addressLine2 && fieldErrorClassName)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>City</span>
          <input
            value={form.city}
            onChange={(event) => setFieldValue("city", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.city && fieldErrorClassName)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>State</span>
          <input
            value={form.state}
            onChange={(event) => setFieldValue("state", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.state && fieldErrorClassName)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>ZIP code</span>
          <input
            value={form.zipCode}
            onChange={(event) => setFieldValue("zipCode", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.zipCode && fieldErrorClassName)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>County</span>
          <input
            value={form.county}
            onChange={(event) => setFieldValue("county", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.county && fieldErrorClassName)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Country</span>
          <input
            value={form.country}
            onChange={(event) => setFieldValue("country", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.country && fieldErrorClassName)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Emergency contact name</span>
          <input
            value={form.emergencyContactName}
            onChange={(event) => setFieldValue("emergencyContactName", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.emergencyContactName && fieldErrorClassName)}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Emergency contact phone</span>
          <input
            value={form.emergencyContactPhone}
            onChange={(event) => setFieldValue("emergencyContactPhone", event.target.value)}
            className={classNames(fieldClassName, fieldErrors.emergencyContactPhone && fieldErrorClassName)}
          />
        </label>
      </div>

      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Notes</span>
        <textarea
          rows={6}
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
          {saving ? "Creating..." : "Create Member"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => router.push("/members")}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
