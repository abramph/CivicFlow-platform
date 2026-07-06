"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const NAV_ITEMS = [
  { href: "/m/dues", label: "Dues" },
  { href: "/m/announcements", label: "Announcements" },
  { href: "/m/events", label: "Events" },
  { href: "/m/payment-history", label: "Payment History" },
  { href: "/m/report-payment", label: "Report a Payment" },
];

/** Shared nav across the member web portal (/m/*) — preserves ?org= across links. */
export function MemberPortalNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const org = searchParams.get("org");
  const suffix = org ? `?org=${encodeURIComponent(org)}` : "";

  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-2xl gap-1 overflow-x-auto px-4 py-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={`${item.href}${suffix}`}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
                active ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"
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
