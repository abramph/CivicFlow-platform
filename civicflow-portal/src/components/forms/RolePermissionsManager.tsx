"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { classNames } from "@/components/forms/formStyles";

type RoleData = {
  role: string;
  permissions: string[];
  defaultPermissions: string[];
  isCustomized: boolean;
};

const ROLE_LABELS: Record<string, string> = {
  ORG_ADMIN: "Admin",
  FINANCE: "Finance / Treasurer",
  STAFF: "Staff",
  READ_ONLY: "Read Only",
};

function groupByResource(permissions: string[]) {
  const groups = new Map<string, string[]>();
  for (const permission of permissions) {
    const resource = permission.split(":")[0];
    const list = groups.get(resource) ?? [];
    list.push(permission);
    groups.set(resource, list);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function formatResource(resource: string) {
  return resource
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatAction(permission: string) {
  // Some permissions have a third segment (e.g. "pta:minutes:review" vs.
  // "pta:minutes:approve") -- taking only split(":")[1] dropped that segment
  // entirely, so distinct permissions like those two rendered as identical
  // "Minutes"/"Minutes" checkboxes with no way to tell them apart. Take
  // everything after the first colon instead, so the full action is shown.
  const action = permission.slice(permission.indexOf(":") + 1);
  return action
    .split(":")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function RolePermissionsManager({
  roles,
  allPermissions,
}: {
  roles: RoleData[];
  allPermissions: string[];
}) {
  const router = useRouter();
  const [activeRole, setActiveRole] = useState(roles[0]?.role ?? "");
  const [checkedByRole, setCheckedByRole] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(roles.map((r) => [r.role, new Set(r.permissions)]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => groupByResource(allPermissions), [allPermissions]);
  const current = roles.find((r) => r.role === activeRole);
  const checked = checkedByRole[activeRole] ?? new Set<string>();

  function toggle(permission: string) {
    setCheckedByRole((state) => {
      const next = new Set(state[activeRole] ?? []);
      if (next.has(permission)) {
        next.delete(permission);
      } else {
        next.add(permission);
      }
      return { ...state, [activeRole]: next };
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/role-permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: activeRole, permissions: Array.from(checked) }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to save permissions.");
        return;
      }
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save permissions.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!current) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/role-permissions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: activeRole }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; data?: { permissions: string[] } }
        | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to reset permissions.");
        return;
      }
      setCheckedByRole((state) => ({
        ...state,
        [activeRole]: new Set(payload.data?.permissions ?? current.defaultPermissions),
      }));
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to reset permissions.");
    } finally {
      setSaving(false);
    }
  }

  if (!current) {
    return <p className="text-sm text-slate-700">No customizable roles found.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {roles.map((r) => (
          <button
            key={r.role}
            type="button"
            onClick={() => setActiveRole(r.role)}
            className={classNames(
              "rounded-lg px-3 py-2 text-sm font-semibold transition",
              activeRole === r.role
                ? "bg-emerald-700 text-white"
                : "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
            )}
          >
            {ROLE_LABELS[r.role] ?? r.role}
            {r.isCustomized ? <span className="ml-1.5 text-xs opacity-80">(customized)</span> : null}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {grouped.map(([resource, permissions]) => (
          <div key={resource} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-2 text-sm font-semibold text-slate-950">{formatResource(resource)}</p>
            <div className="space-y-1.5">
              {permissions.map((permission) => (
                <label key={permission} className="flex items-center gap-2 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    checked={checked.has(permission)}
                    onChange={() => toggle(permission)}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-500"
                  />
                  <span className="capitalize">{formatAction(permission)}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {saving ? "Saving..." : `Save ${ROLE_LABELS[activeRole] ?? activeRole} Permissions`}
        </button>
        <button
          type="button"
          disabled={saving || !current.isCustomized}
          onClick={handleReset}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Reset to Default
        </button>
      </div>
    </div>
  );
}
