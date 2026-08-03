"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { classNames, fieldClassName, fieldErrorClassName } from "@/components/forms/formStyles";
import { formatDateTime, formatText } from "@/lib/formatting";

const roleOptions = ["ORG_OWNER", "ORG_ADMIN", "FINANCE", "STAFF", "READ_ONLY"] as const;
type RoleOption = (typeof roleOptions)[number];

// Mirrors auth-guards.ts's ROLE_RANK — kept in sync manually since this is a
// client component and that file is server-only (imports next-auth session
// helpers). Used only to hide role choices the server would reject anyway;
// the server's rank check is the actual enforcement.
const ROLE_RANK: Record<string, number> = {
  MEMBER: -1,
  READ_ONLY: 0,
  STAFF: 1,
  FINANCE: 2,
  ORG_ADMIN: 3,
  ORG_OWNER: 4,
  SUPER_ADMIN: 5,
};

type MembershipRow = {
  id: string;
  role: string;
  joinedAt: string;
  user: {
    id: string;
    email: string;
    displayName: string | null;
    createdAt: string;
  };
};

export function UsersAndRolesManager({
  memberships,
  currentUserId,
  canManage,
  actorRole,
  prefill,
}: {
  memberships: MembershipRow[];
  currentUserId: string;
  canManage: boolean;
  actorRole: string;
  /** Pre-fills the invite form, e.g. when arriving from a "Invite as
   * officer" link on a committee's chair/co-chair — see
   * src/app/settings/users/page.tsx's searchParams handling. */
  prefill?: { displayName?: string; email?: string; role?: string };
}) {
  const router = useRouter();
  const assignableRoleOptions = roleOptions.filter((option) => ROLE_RANK[option] <= (ROLE_RANK[actorRole] ?? -1));
  const defaultInviteRole = assignableRoleOptions.includes("STAFF")
    ? "STAFF"
    : (assignableRoleOptions[assignableRoleOptions.length - 1] ?? "READ_ONLY");
  const prefillRole = prefill?.role && assignableRoleOptions.includes(prefill.role as RoleOption) ? (prefill.role as RoleOption) : defaultInviteRole;
  const [inviteForm, setInviteForm] = useState({
    displayName: prefill?.displayName ?? "",
    email: prefill?.email ?? "",
    role: prefillRole as RoleOption,
    temporaryPassword: "",
  });
  const [savingInvite, setSavingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function setInviteValue<K extends keyof typeof inviteForm>(key: K, value: (typeof inviteForm)[K]) {
    setInviteForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};

    if (!inviteForm.displayName.trim()) {
      nextErrors.displayName = "Display name is required.";
    }
    if (!inviteForm.email.trim()) {
      nextErrors.email = "Email is required.";
    }
    if (inviteForm.temporaryPassword.length < 10) {
      nextErrors.temporaryPassword = "Temporary password must be at least 10 characters.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setSavingInvite(true);
    setInviteError(null);

    try {
      const response = await fetch("/api/organization-memberships", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          displayName: inviteForm.displayName.trim(),
          email: inviteForm.email.trim(),
          role: inviteForm.role,
          temporaryPassword: inviteForm.temporaryPassword,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        setInviteError(payload?.error || "Failed to invite the user.");
        return;
      }

      router.refresh();
      setInviteForm({
        displayName: "",
        email: "",
        role: "STAFF",
        temporaryPassword: "",
      });
    } catch (submitError) {
      setInviteError(
        submitError instanceof Error ? submitError.message : "Failed to invite the user."
      );
    } finally {
      setSavingInvite(false);
    }
  }

  async function updateRole(membershipId: string, role: RoleOption) {
    setRowBusyId(membershipId);
    setRowError(null);

    try {
      const response = await fetch(`/api/organization-memberships/${membershipId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        setRowError(payload?.error || "Failed to update role.");
        return;
      }

      router.refresh();
    } catch (submitError) {
      setRowError(
        submitError instanceof Error ? submitError.message : "Failed to update role."
      );
    } finally {
      setRowBusyId(null);
    }
  }

  async function removeAccess(membershipId: string) {
    setRowBusyId(membershipId);
    setRowError(null);

    try {
      const response = await fetch(`/api/organization-memberships/${membershipId}`, {
        method: "DELETE",
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        setRowError(payload?.error || "Failed to remove access.");
        return;
      }

      router.refresh();
    } catch (submitError) {
      setRowError(
        submitError instanceof Error ? submitError.message : "Failed to remove access."
      );
    } finally {
      setRowBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {canManage ? (
        <form className="space-y-5" onSubmit={handleInvite}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-2 text-sm font-medium text-slate-900">
              <span>Display name</span>
              <input
                value={inviteForm.displayName}
                onChange={(event) => setInviteValue("displayName", event.target.value)}
                className={classNames(fieldClassName, fieldErrors.displayName && fieldErrorClassName)}
              />
              {fieldErrors.displayName ? <p className="text-sm font-medium text-red-700">{fieldErrors.displayName}</p> : null}
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-900">
              <span>Email</span>
              <input
                type="email"
                value={inviteForm.email}
                onChange={(event) => setInviteValue("email", event.target.value)}
                className={classNames(fieldClassName, fieldErrors.email && fieldErrorClassName)}
              />
              {fieldErrors.email ? <p className="text-sm font-medium text-red-700">{fieldErrors.email}</p> : null}
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-900">
              <span>Role</span>
              <select
                value={inviteForm.role}
                onChange={(event) => setInviteValue("role", event.target.value as RoleOption)}
                className={fieldClassName}
              >
                {assignableRoleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-900">
              <span>Temporary password</span>
              <input
                type="password"
                value={inviteForm.temporaryPassword}
                onChange={(event) => setInviteValue("temporaryPassword", event.target.value)}
                className={classNames(fieldClassName, fieldErrors.temporaryPassword && fieldErrorClassName)}
              />
              {fieldErrors.temporaryPassword ? (
                <p className="text-sm font-medium text-red-700">{fieldErrors.temporaryPassword}</p>
              ) : null}
            </label>
          </div>

          {inviteError ? (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {inviteError}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={savingInvite}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {savingInvite ? "Inviting..." : "Invite User"}
          </button>
        </form>
      ) : (
        <p className="text-sm text-slate-700">
          You have read-only access to the user roster. Ask an owner or admin for invite/role-change access if you need it.
        </p>
      )}

      {rowError ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {rowError}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-700">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {memberships.map((membership) => (
              <tr key={membership.id} className="border-t border-slate-100">
                <td className="px-4 py-3 text-slate-900">
                  <p className="font-semibold">{formatText(membership.user.displayName, "Unnamed user")}</p>
                  <p className="text-xs text-slate-700">Account created {formatDateTime(membership.user.createdAt)}</p>
                </td>
                <td className="px-4 py-3 text-slate-900">{membership.user.email}</td>
                <td className="px-4 py-3 text-slate-900">
                  {(() => {
                    const rowOutranksActor = (ROLE_RANK[membership.role] ?? 0) > (ROLE_RANK[actorRole] ?? -1);
                    if (!canManage || rowOutranksActor) {
                      return membership.role;
                    }
                    return (
                      <select
                        defaultValue={membership.role}
                        disabled={rowBusyId === membership.id}
                        onChange={(event) => updateRole(membership.id, event.target.value as RoleOption)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950"
                      >
                        {!assignableRoleOptions.includes(membership.role as RoleOption) ? (
                          <option value={membership.role}>{membership.role}</option>
                        ) : null}
                        {assignableRoleOptions.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    );
                  })()}
                </td>
                <td className="px-4 py-3 text-slate-900">{formatDateTime(membership.joinedAt)}</td>
                <td className="px-4 py-3 text-slate-900">
                  {canManage ? (
                    <button
                      type="button"
                      disabled={
                        rowBusyId === membership.id ||
                        membership.user.id === currentUserId ||
                        (ROLE_RANK[membership.role] ?? 0) > (ROLE_RANK[actorRole] ?? -1)
                      }
                      onClick={() => removeAccess(membership.id)}
                      className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                    >
                      {membership.user.id === currentUserId ? "Current user" : rowBusyId === membership.id ? "Working..." : "Remove"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
