"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DismissSetupBannerButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function dismiss() {
    setPending(true);
    try {
      await fetch("/api/dashboard/dismiss-setup-banner", { method: "POST" });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={dismiss}
      disabled={pending}
      className="text-xs font-semibold text-amber-800 hover:underline disabled:opacity-60"
    >
      {pending ? "Dismissing..." : "Dismiss"}
    </button>
  );
}
