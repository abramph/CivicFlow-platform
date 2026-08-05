import Link from "next/link";
import type { ReactNode } from "react";

type ProfileAction = {
  href: string;
  label: string;
  tone?: "primary" | "secondary";
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

/** Generalizes the profile-page header pattern: name, optional status badge,
 * optional subtitle, and a permission-aware quick-actions row. */
export function ProfileHeader({
  name,
  subtitle,
  statusBadge,
  actions = [],
}: {
  name: string;
  subtitle?: ReactNode;
  statusBadge?: ReactNode;
  actions?: ProfileAction[];
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-300 bg-white p-5 shadow-sm lg:flex-row lg:items-start lg:justify-between">
      <div className="flex items-start gap-4">
        <div
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-lg font-semibold text-emerald-800"
        >
          {initials(name)}
        </div>
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{name}</h1>
            {statusBadge}
          </div>
          {subtitle ? <p className="max-w-2xl text-sm leading-6 text-slate-700">{subtitle}</p> : null}
        </div>
      </div>
      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Link
              key={`${action.href}:${action.label}`}
              href={action.href}
              className={
                action.tone === "primary"
                  ? "rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                  : "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
              }
            >
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
