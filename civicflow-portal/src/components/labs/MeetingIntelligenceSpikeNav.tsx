"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/labs/meeting-intelligence-spike", label: "Overview", exact: true },
  { href: "/labs/meeting-intelligence-spike/jobs", label: "Recent Jobs" },
  { href: "/labs/meeting-intelligence-spike/providers", label: "Provider Diagnostics" },
  { href: "/labs/meeting-intelligence-spike/costs", label: "Cost Estimates" },
  { href: "/labs/meeting-intelligence-spike/privacy", label: "Privacy Information" },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MeetingIntelligenceSpikeNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Meeting Intelligence Spike" className="flex flex-wrap gap-1 border-b border-slate-200">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href, item.exact);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
              active ? "border-emerald-700 text-emerald-800" : "border-transparent text-slate-700 hover:border-slate-300 hover:text-slate-950"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
