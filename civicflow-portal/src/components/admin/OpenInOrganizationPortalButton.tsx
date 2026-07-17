"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

/**
 * Only ever enabled for an organization the current platform admin already
 * has a real, active membership in — re-verified server-side by
 * /api/organization/select regardless of what this button believes, so
 * there is no privilege-escalation path here even if this check were wrong.
 */
export function OpenInOrganizationPortalButton({ organizationId }: { organizationId: string }) {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasMembership = session?.organizations?.some((o) => o.organizationId === organizationId) ?? false;
  if (!hasMembership) return null;

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/organization/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      if (!response.ok) {
        setError("Could not switch to this organization.");
        return;
      }
      await update();
      router.push("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {loading ? "Switching…" : "Open in organization portal →"}
      </button>
      {error ? <p className="mt-1 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
