"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

function dismissKey(organizationId: string, memberId: string) {
  return `cf_sms_opt_in_banner_dismissed:${organizationId}:${memberId}`;
}

/**
 * Dismissible nudge shown to a member who hasn't given SMS consent yet.
 * Dismissal is stored in localStorage rather than the database — this is
 * pure UI state (not an auditable consent event), so there's no need for a
 * server round trip or schema field for it.
 */
export function SmsOptInBanner({ organizationId, memberId }: { organizationId: string; memberId: string }) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(dismissKey(organizationId, memberId)) === "1");
    } catch {
      setDismissed(false);
    }
  }, [organizationId, memberId]);

  if (dismissed) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(dismissKey(organizationId, memberId), "1");
    } catch {
      // Ignore storage failures (private browsing, etc.) — banner just reappears next visit.
    }
    setDismissed(true);
  }

  return (
    <div className="mx-4 mt-3 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
      <div className="flex-1 text-sm text-emerald-900">
        <p className="font-semibold">Get text updates from your organization</p>
        <p className="mt-1 text-emerald-800">
          Turn on SMS notifications for payment confirmations, event reminders, and announcements.{" "}
          <Link href="/m/notifications" className="font-semibold underline">
            Enable text notifications
          </Link>
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-lg px-2 py-1 text-emerald-700 hover:bg-emerald-100"
      >
        ✕
      </button>
    </div>
  );
}
