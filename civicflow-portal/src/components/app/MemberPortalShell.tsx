"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const NAV_ITEMS = [
  { href: "/m/dues", label: "Dues" },
  { href: "/m/inbox", label: "Inbox" },
  { href: "/m/announcements", label: "Announcements" },
  { href: "/m/events", label: "Events" },
  { href: "/m/payment-history", label: "Payment History" },
  { href: "/m/report-payment", label: "Report a Payment" },
];

interface MemberSessionSummary {
  organizationId: string;
  organizationName: string;
  organizationLogoUrl: string | null;
  organizations: { organizationId: string; organizationName: string; organizationLogoUrl: string | null }[];
}

export function MemberPortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const org = searchParams.get("org");
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<MemberSessionSummary | null>(null);

  useEffect(() => {
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    fetch(`/api/member-portal/session${query}`)
      .then((response) => response.json())
      .then((payload) => setSession(payload?.ok ? payload.data : null))
      .catch(() => setSession(null));
  }, [org]);

  function linkHref(href: string) {
    return org ? `${href}?org=${encodeURIComponent(org)}` : href;
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        {session?.organizationLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.organizationLogoUrl} alt="" className="h-7 w-7 rounded object-cover" />
        ) : null}
        <span className="truncate font-semibold text-slate-900">{session?.organizationName ?? "CivicFlow"}</span>
      </header>

      {open ? (
        <div className="fixed inset-0 z-20 flex">
          <div className="flex w-72 max-w-[80vw] flex-col gap-4 overflow-y-auto bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-500">Menu</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {session && session.organizations.length > 1 ? (
              <div className="space-y-1 border-b border-slate-200 pb-4">
                <p className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Organization</p>
                {session.organizations.map((option) => (
                  <Link
                    key={option.organizationId}
                    href={`${pathname}?org=${encodeURIComponent(option.organizationId)}`}
                    onClick={() => setOpen(false)}
                    className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                      option.organizationId === session.organizationId
                        ? "bg-emerald-600 text-white"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {option.organizationName}
                  </Link>
                ))}
              </div>
            ) : null}

            <nav className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={linkHref(item.href)}
                    onClick={() => setOpen(false)}
                    className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                      active ? "bg-emerald-600 text-white" : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="flex-1 cursor-default bg-black/30"
          />
        </div>
      ) : null}

      {children}
    </div>
  );
}
