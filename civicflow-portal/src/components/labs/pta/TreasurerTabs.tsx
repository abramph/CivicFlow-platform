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
export function TreasurerTabs() {
  const pathname = usePathname();

  return (
    <div role="tablist" aria-label="Treasurer sections" className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
      {TREASURER_TABS.map((tab) => {
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
