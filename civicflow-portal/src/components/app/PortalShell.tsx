"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState, type ReactNode } from "react";
import { LogoutButton } from "@/components/LogoutButton";
import { getNavigationProfile } from "@/lib/vertical-navigation";
import { getVerticalTerminology } from "@/lib/vertical-terminology";
import { roleRank, type Role } from "@/lib/rbac";

function isHiddenPath(pathname: string) {
  // Member-facing pages render their own chrome — never wrap them in the
  // staff sidebar shell. The QR full-screen display and printable sheet are
  // meant to fill a projector/printed page with no staff nav around them.
  return (
    pathname === "/login" ||
    pathname === "/login/mfa" ||
    pathname === "/signup" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/verify-email" ||
    pathname === "/pricing" ||
    pathname === "/terms" ||
    pathname === "/privacy" ||
    pathname === "/sms-opt-in" ||
    pathname === "/buy" ||
    pathname === "/accept-invite" ||
    pathname === "/select-organization" ||
    pathname === "/attendance/check-in" ||
    pathname.startsWith("/m/") ||
    pathname.endsWith("/attendance-session/display") ||
    pathname.endsWith("/attendance-session/print")
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/settings") return pathname === "/settings";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status, update } = useSession();
  const [switching, setSwitching] = useState(false);

  async function switchOrganization(organizationId: string) {
    if (!session?.organizations || organizationId === session.organizationId) return;
    const target = session.organizations.find((o) => o.organizationId === organizationId);
    if (!target) return;

    setSwitching(true);
    try {
      const response = await fetch("/api/organization/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      if (!response.ok) return;

      // Read the refreshed session's own primaryVertical rather than
      // target.primaryVertical (the RAW stored value from the org list,
      // which is deliberately not reconciled against live PTA Labs
      // enrollment — see getUserOrgMemberships). The refreshed session's
      // value IS reconciled (see resolveSessionIdentity), so it's the only
      // trustworthy source for "does the new active org actually get the
      // PTA experience right now."
      const refreshed = await update();
      if (target.role === "MEMBER") {
        router.push(target.memberId ? "/m/dues" : "/m/my-household");
      } else {
        // Land on the new organization's own vertical dashboard rather than
        // refreshing whatever page happened to be open — that page may not
        // even exist in the new organization's nav (e.g. switching away from
        // a PTA org while on a /labs/pta/* page), which would otherwise leave
        // stale, wrong-vertical context on screen after the switch.
        router.push(refreshed?.primaryVertical === "PTA" ? "/labs/pta/dashboard" : "/dashboard");
        router.refresh();
      }
    } finally {
      setSwitching(false);
    }
  }

  if (isHiddenPath(pathname)) {
    return <>{children}</>;
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-900">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-700">Loading Unestra…</p>
          </div>
        </div>
      </div>
    );
  }

  const hasSaasSession = Boolean(session?.userId);
  const hasLegacySession = Boolean(session?.api_key && session?.org_id && !session?.userId);

  if (!hasSaasSession && !hasLegacySession) {
    return <>{children}</>;
  }

  // Members have zero staff permissions — never render the staff nav shell
  // around them. The page itself also redirects to /m/dues; this just
  // avoids a flash of staff navigation while that redirect resolves.
  if (hasSaasSession && session?.role === "MEMBER") {
    return <>{children}</>;
  }

  const legacyNav = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/payments", label: "Payments" },
    { href: "/settings", label: "Settings" },
  ];

  // Global platform access (PlatformAccess), independent of the active
  // organization's role — deliberately NOT session?.role, so switching
  // organizations never hides or reveals this link.
  const canSeePlatformAdmin =
    hasSaasSession && Boolean(session?.hasPlatformAccess);
  const can = (permission: string) => (session?.permissions ?? []).includes(permission);
  const roleAtLeast = (minRole: Role) => (session?.role ? roleRank(session.role) >= roleRank(minRole) : false);

  // Each vertical (Community/PTA/Union/HOA) gets its own navigation profile
  // — a PTA organization sees only PTA-flavored items, never the Community
  // list with a PTA section bolted on (see getNavigationProfile).
  const verticalNavItems = getNavigationProfile(session?.primaryVertical ?? "COMMUNITY");
  const navItems = hasSaasSession ? verticalNavItems : legacyNav;

  const visibleNavItems = hasSaasSession
    ? verticalNavItems.filter((item) => {
        if (item.permission && !can(item.permission)) return false;
        if (item.minRole && !roleAtLeast(item.minRole)) return false;
        return true;
      })
    : navItems;

  const orgLabel =
    session?.orgName || session?.org_id || "(setup required)";
  const activeVertical = session?.primaryVertical ?? "COMMUNITY";
  const landingPage = activeVertical === "PTA" ? "/labs/pta/dashboard" : "/dashboard";
  const verticalTerminology = getVerticalTerminology(activeVertical);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-72 border-r border-slate-200 bg-white lg:block">
          <div className="border-b border-slate-200 px-6 py-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
              Unestra
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">{verticalTerminology.productLabel}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-700">{verticalTerminology.dashboardWelcome}</p>
          </div>

          <nav className="space-y-1 px-4 py-5">
            {visibleNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                  isActive(pathname, item.href)
                    ? "bg-emerald-700 text-white shadow-sm"
                    : "text-slate-800 hover:bg-slate-100"
                }`}
              >
                {item.label}
              </Link>
            ))}
            {canSeePlatformAdmin ? (
              <Link
                href="/admin/platform"
                className={`block rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                  isActive(pathname, "/admin/platform") && !pathname.startsWith("/admin/platform/sms")
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-800 hover:bg-slate-100"
                }`}
              >
                APH Operations Center
              </Link>
            ) : null}
            {canSeePlatformAdmin ? (
              <Link
                href="/admin/platform/sms"
                className={`block rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                  isActive(pathname, "/admin/platform/sms")
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-800 hover:bg-slate-100"
                }`}
              >
                SMS Administration
              </Link>
            ) : null}
          </nav>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          <header className="border-b border-slate-200 bg-white">
            <div className="flex flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600">Organization</p>
                {hasSaasSession && session?.organizations && session.organizations.length > 1 ? (
                  <select
                    aria-label="Switch organization"
                    value={session.organizationId ?? ""}
                    disabled={switching}
                    onChange={(event) => switchOrganization(event.target.value)}
                    className="mt-0.5 rounded-lg border border-slate-300 bg-white px-2 py-1 text-lg font-semibold text-slate-950 disabled:opacity-60"
                  >
                    {session.organizations.map((option) => (
                      <option key={option.organizationId} value={option.organizationId}>
                        {option.organizationName}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-lg font-semibold text-slate-950">{orgLabel}</p>
                )}
                {hasSaasSession && session?.role ? (
                  <p className="mt-1 text-sm text-slate-700">Role: {session.role}</p>
                ) : null}
                {canSeePlatformAdmin ? (
                  // Global identity, shown alongside — not instead of — the
                  // active-organization context above, so it's clear these
                  // are two independent things: who you are platform-wide,
                  // and which tenant you're currently working in.
                  <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                    Platform Administrator
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={landingPage}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                >
                  {verticalTerminology.dashboardTitle}
                </Link>
                <LogoutButton />
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-6 md:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
