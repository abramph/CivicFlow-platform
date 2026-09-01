"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const TREASURER_TABS = [
  { href: "/labs/pta/finance/overview", label: "Overview" },
  { href: "/labs/pta/finance/budget", label: "Budget" },
  { href: "/labs/pta/finance/expenditures", label: "Expenditures" },
  { href: "/labs/pta/finance/reimbursements", label: "Reimbursements" },
] as const;

/**
 * feature/pta-treasurer-expenditure-experience (E1) — internal Treasurer
 * navigation. Deliberately real <Link> anchors driven by the current
 * pathname rather than client-only tab state: that's what makes direct
 * URLs, refresh, and browser back/forward all work for free, and it keeps
 * every tab keyboard-reachable the same way any other link is (Tab, Enter)
 * with no custom key handling needed. Active state is both visual (styling)
 * and programmatic (aria-selected), so it's conveyed to assistive tech too.
 */
export function TreasurerTabs({ canReadExpenditures = true }: { canReadExpenditures?: boolean }) {
  const pathname = usePathname();
  // Overview/Budget/Reimbursements all gate on the same budget:read
  // permission that gets a viewer into this shell in the first place, so
  // reaching this component already means those three are reachable.
  // Expenditures gates on the separate expenditures:read permission, which
  // budget:read does not imply (see rbac.ts's STAFF grant) -- shown
  // unconditionally, it would dead-end a STAFF viewer at
  // /dashboard?error=forbidden. Hiding it here keeps the nav honest about
  // what a direct link to it would actually do.
  const tabs = TREASURER_TABS.filter((tab) => canReadExpenditures || tab.href !== "/labs/pta/finance/expenditures");

  return (
    <div role="tablist" aria-label="Treasurer sections" className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            className={
              active
                ? "rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
                : "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
