"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/admin/platform", label: "Overview", exact: true },
  { href: "/admin/platform/organizations", label: "Organizations" },
  { href: "/admin/platform/people", label: "People" },
  { href: "/admin/platform/billing", label: "Billing" },
  { href: "/admin/platform/communications", label: "Communications" },
  { href: "/admin/platform/health", label: "System Health" },
  { href: "/admin/platform/jobs", label: "Background Operations" },
  { href: "/admin/platform/audit", label: "Audit" },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function OperationsCenterNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="APH Operations Center" className="border-b border-slate-200 bg-white">
      <div className="flex gap-1 overflow-x-auto px-4 md:px-6" role="list">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href, item.exact);
          return (
            <Link
              key={item.href}
              href={item.href}
              role="listitem"
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                active
                  ? "border-emerald-700 text-emerald-800"
                  : "border-transparent text-slate-700 hover:border-slate-300 hover:text-slate-950"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
