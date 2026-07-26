"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface PtaTab {
  href: string;
  label: string;
  visible: boolean;
}

function TabRow({ tabs, pathname }: { tabs: PtaTab[]; pathname: string }) {
  const visible = tabs.filter((tab) => tab.visible);
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
              active ? "bg-emerald-700 text-white shadow-sm" : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Two independent rows so an officer who is also a parent (as in the fictional seed data) can see both without either group crowding out the other. */
export function PtaTabNav({ officerTabs, parentTabs }: { officerTabs: PtaTab[]; parentTabs: PtaTab[] }) {
  const pathname = usePathname();
  const hasOfficerTabs = officerTabs.some((t) => t.visible);
  const hasParentTabs = parentTabs.some((t) => t.visible);
  if (!hasOfficerTabs && !hasParentTabs) return null;

  return (
    <nav aria-label="Unestra for PTA" className="space-y-2 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
      <TabRow tabs={officerTabs} pathname={pathname} />
      {hasOfficerTabs && hasParentTabs ? <div className="border-t border-slate-200 pt-2" /> : null}
      <TabRow tabs={parentTabs} pathname={pathname} />
    </nav>
  );
}
