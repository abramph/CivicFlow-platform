"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";

/**
 * Mounted at the root layout, outside PortalShell's own conditional shell —
 * PortalShell renders bare children (no sidebar) for MEMBER-role sessions,
 * but an impersonated MEMBER (a parent) is exactly the case this banner
 * must never disappear for. It must "always remain visible" regardless of
 * which role is being impersonated or which page hides the normal nav.
 */
export function ImpersonationBanner() {
  const { data: session, update } = useSession();
  const [exiting, setExiting] = useState(false);

  if (!session?.impersonation?.active) return null;
  const { targetDisplayName, targetEmail, organizationName } = session.impersonation;

  async function exit() {
    setExiting(true);
    try {
      await fetch("/api/admin/impersonate/stop", { method: "POST" });
      await update();
      window.location.assign("/admin/platform/organizations");
    } finally {
      setExiting(false);
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm font-semibold text-amber-950 shadow"
    >
      <span>
        You are impersonating <strong>{targetDisplayName ?? targetEmail}</strong> in <strong>{organizationName}</strong>.
      </span>
      <button
        type="button"
        disabled={exiting}
        onClick={exit}
        className="rounded-lg bg-amber-950 px-3 py-1.5 text-xs font-bold text-amber-50 hover:bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 disabled:opacity-60"
      >
        {exiting ? "Exiting…" : "Return to Platform Admin"}
      </button>
    </div>
  );
}
