"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OrgRole } from "@prisma/client";

interface MembershipOption {
  organizationId: string;
  organizationName: string;
  organizationLogoUrl: string | null;
  role: OrgRole;
  memberStatus: string | null;
}

const ROLE_LABELS: Record<OrgRole, string> = {
  SUPER_ADMIN: "Super Admin",
  ORG_OWNER: "Owner",
  ORG_ADMIN: "Admin",
  FINANCE: "Finance",
  STAFF: "Staff",
  READ_ONLY: "Read Only",
  MEMBER: "Member",
};

export function OrganizationPicker({ memberships }: { memberships: MembershipOption[] }) {
  const router = useRouter();
  const [pendingOrgId, setPendingOrgId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function selectOrganization(organizationId: string, role: OrgRole) {
    setPendingOrgId(organizationId);
    setError(null);
    try {
      const response = await fetch("/api/organization/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error ?? "Unable to select that organization. Please try again.");
        setPendingOrgId(null);
        return;
      }
      router.push(role === "MEMBER" ? "/m/dues" : "/dashboard");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
      setPendingOrgId(null);
    }
  }

  return (
    <div>
      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      <div className="space-y-2">
        {memberships.map((option) => (
          <button
            key={option.organizationId}
            type="button"
            disabled={pendingOrgId !== null}
            onClick={() => selectOrganization(option.organizationId, option.role)}
            className="flex w-full items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-left transition hover:border-emerald-400 hover:bg-emerald-50 disabled:opacity-60"
          >
            {option.organizationLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={option.organizationLogoUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100 text-sm font-semibold text-slate-500">
                {option.organizationName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{option.organizationName}</p>
              <p className="text-xs text-slate-500">
                {ROLE_LABELS[option.role]}
                {option.memberStatus ? ` · ${option.memberStatus}` : ""}
              </p>
            </div>
            {pendingOrgId === option.organizationId ? (
              <span className="text-xs font-medium text-emerald-600">Loading…</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
