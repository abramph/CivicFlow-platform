"use client";

import { useState } from "react";
import { OrganizationOnboardingForm } from "@/components/forms/OrganizationOnboardingForm";

/**
 * The first screen after account creation/login for a user with no
 * organization: choose to create a new one (reveals the vertical-selection
 * wizard) or join an existing one. There is no self-service org search/join
 * request anywhere in this codebase today — building one would be a new
 * business feature, out of scope here — so "Join" surfaces the one real
 * mechanism that already exists (an administrator-sent email invite) rather
 * than a dead-end or a fabricated feature.
 */
export function OrganizationSetupChoice() {
  const [mode, setMode] = useState<"choice" | "create">("choice");

  if (mode === "create") {
    return <OrganizationOnboardingForm />;
  }

  return (
    <div className="space-y-4">
      <div
        className="grid gap-4 sm:grid-cols-2"
        role="radiogroup"
        aria-label="How would you like to get started?"
      >
        <button
          type="button"
          onClick={() => setMode("create")}
          className="flex flex-col items-start gap-2 rounded-xl border border-slate-200 bg-white px-5 py-4 text-left transition-colors hover:border-emerald-400 hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        >
          <span className="text-base font-semibold text-slate-950">Create a new organization</span>
          <span className="text-sm text-slate-600">
            Set up a new Community, PTA, Union, or HOA organization and become its owner.
          </span>
        </button>

        <div className="flex flex-col items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-left">
          <span className="text-base font-semibold text-slate-950">Join an existing organization</span>
          <span className="text-sm text-slate-600">
            Ask an administrator at your organization to send you an email invitation. Once invited, you&apos;ll
            get a link to accept and join — there&apos;s no separate signup needed for that.
          </span>
        </div>
      </div>
    </div>
  );
}
