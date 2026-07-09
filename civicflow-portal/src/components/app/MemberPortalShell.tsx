"use client";

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { SmsOptInBanner } from "@/components/app/SmsOptInBanner";

const NAV_ITEMS = [
  { href: "/m/dues", label: "Dues" },
  { href: "/m/inbox", label: "Inbox" },
  { href: "/m/announcements", label: "Announcements" },
  { href: "/m/events", label: "Events" },
  { href: "/m/payment-history", label: "Payment History" },
  { href: "/m/make-payment", label: "Make a Payment" },
  { href: "/m/report-payment", label: "Report a Payment" },
  { href: "/m/notifications", label: "Notification Settings" },
];

export function MemberPortalShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const org = searchParams.get("org");
  const [open, setOpen] = useState(false);
  const { data: session, update } = useSession();
  const [switching, setSwitching] = useState(false);
  // Defaults to opted-in (banner hidden) until the fetch resolves, so the
  // banner doesn't flash on every load — matches the previous behavior of
  // not rendering it until the session fetch completed.
  const [smsOptIn, setSmsOptIn] = useState(true);

  // session.organizations carries every org this user belongs to (any
  // role); the member portal switcher only ever offers the ones where
  // they're a MEMBER — switching to a staff-role org belongs in the staff
  // shell's own switcher, not here.
  const memberOrgs = (session?.organizations ?? []).filter((o) => o.role === "MEMBER");
  const organizationId = session?.organizationId ?? null;
  const memberId = session?.memberId ?? null;
  const active = memberOrgs.find((o) => o.organizationId === organizationId) ?? memberOrgs[0] ?? null;

  useEffect(() => {
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    fetch(`/api/member-portal/session${query}`)
      .then((response) => response.json())
      .then((payload) => setSmsOptIn(payload?.ok ? Boolean(payload.data?.smsOptIn) : true))
      .catch(() => setSmsOptIn(true));
  }, [org]);

  function linkHref(href: string) {
    return org ? `${href}?org=${encodeURIComponent(org)}` : href;
  }

  async function switchOrganization(nextOrganizationId: string) {
    if (!organizationId || nextOrganizationId === organizationId) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      const response = await fetch("/api/organization/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: nextOrganizationId }),
      });
      if (response.ok) {
        setOpen(false);
        await update();
        // Cookie now carries the choice — drop any ?org= so every future link
        // (including ones that don't set it explicitly) uses the new org.
        router.replace(pathname);
        router.refresh();
      }
    } finally {
      setSwitching(false);
    }
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
        {active?.organizationLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={active.organizationLogoUrl} alt="" className="h-7 w-7 rounded object-cover" />
        ) : null}
        <span className="truncate font-semibold text-slate-900">{active?.organizationName ?? "CivicFlow"}</span>
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

            {memberOrgs.length > 1 ? (
              <div className="space-y-1 border-b border-slate-200 pb-4">
                <p className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Organization</p>
                {memberOrgs.map((option) => (
                  <button
                    key={option.organizationId}
                    type="button"
                    disabled={switching}
                    onClick={() => switchOrganization(option.organizationId)}
                    className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-medium disabled:opacity-60 ${
                      option.organizationId === organizationId
                        ? "bg-emerald-600 text-white"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {option.organizationName}
                  </button>
                ))}
              </div>
            ) : null}

            <nav className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={linkHref(item.href)}
                    onClick={() => setOpen(false)}
                    className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                      isActive ? "bg-emerald-600 text-white" : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
              {memberOrgs.length > 1 ? (
                <Link
                  href="/m/all-organizations"
                  onClick={() => setOpen(false)}
                  className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                    pathname === "/m/all-organizations" ? "bg-emerald-600 text-white" : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  All Organizations
                </Link>
              ) : null}
            </nav>

            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="mt-auto rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Log Out
            </button>
          </div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="flex-1 cursor-default bg-black/30"
          />
        </div>
      ) : null}

      {!smsOptIn && organizationId && memberId ? (
        <SmsOptInBanner organizationId={organizationId} memberId={memberId} />
      ) : null}

      {children}
    </div>
  );
}
