"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState, type ReactNode } from "react";
import { LogoutButton } from "@/components/LogoutButton";

function isHiddenPath(pathname: string) {
  // Member-facing pages render their own chrome — never wrap them in the
  // staff sidebar shell. The QR full-screen display and printable sheet are
  // meant to fill a projector/printed page with no staff nav around them.
  return (
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/verify-email" ||
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

      await update();
      if (target.role === "MEMBER") {
        router.push("/m/dues");
      } else {
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

  const saasNav = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/inbox", label: "Inbox" },
    { href: "/members", label: "Members" },
    { href: "/contributions", label: "Contributions" },
    { href: "/dues", label: "Dues" },
    { href: "/dues/reminders", label: "Dues Campaigns" },
    { href: "/payment-reports", label: "Payment Reports" },
    { href: "/campaigns", label: "Campaigns" },
    { href: "/events", label: "Events" },
    { href: "/meetings", label: "Meetings" },
    { href: "/communications", label: "Communications" },
    { href: "/communications/campaigns", label: "Communication Campaigns" },
    { href: "/attendance", label: "Attendance" },
    { href: "/expenditures", label: "Expenditures" },
    { href: "/reports", label: "Reports" },
    { href: "/receipts", label: "Receipts" },
    { href: "/reminders", label: "Reminders" },
    { href: "/payments/imports", label: "Payment Imports" },
    { href: "/payments/reconciliation", label: "Reconciliation" },
    { href: "/audit-logs", label: "Audit Logs" },
    { href: "/settings/sms-consent", label: "SMS Consent" },
    { href: "/payment-links", label: "Payment Links" },
    { href: "/settings", label: "Settings" },
    { href: "/settings/organization", label: "Organization" },
    { href: "/settings/categories", label: "Categories" },
    { href: "/settings/dues", label: "Dues Setup" },
    { href: "/settings/payment-methods", label: "Payment Methods" },
    { href: "/settings/users", label: "Users & Roles" },
    { href: "/settings/roles", label: "Role Permissions" },
    { href: "/settings/security", label: "Security" },
    { href: "/settings/billing", label: "Billing" },
    { href: "/onboarding/organization", label: "Onboarding" },
    { href: "/migration", label: "Migration" },
    { href: "/import", label: "Import Data" },
  ];

  const legacyNav = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/payments", label: "Payments" },
    { href: "/settings", label: "Settings" },
  ];

  const navItems = hasSaasSession ? saasNav : legacyNav;
  const canSeePlatformAdmin =
    hasSaasSession && session?.role === "SUPER_ADMIN";
  const can = (permission: string) => (session?.permissions ?? []).includes(permission);

  const visibleNavItems = hasSaasSession
    ? navItems.filter((item) => {
        if (item.href.startsWith("/settings/organization")) {
          return can("org_settings:read");
        }
        if (item.href.startsWith("/settings/categories")) {
          return can("org_settings:read");
        }
        if (item.href.startsWith("/settings/dues")) {
          return can("dues:read");
        }
        if (item.href.startsWith("/settings/payment-methods")) {
          return can("org_settings:read");
        }
        if (item.href.startsWith("/settings/roles")) {
          return session?.role === "ORG_OWNER" || session?.role === "SUPER_ADMIN";
        }
        if (item.href.startsWith("/settings/users")) {
          return can("users:read");
        }
        if (item.href.startsWith("/settings/billing")) {
          return can("billing:read");
        }
        if (item.href.startsWith("/communications")) {
          return can("communications:read");
        }
        if (item.href.startsWith("/payments/imports") || item.href.startsWith("/payments/reconciliation")) {
          return can("dues:read");
        }
        if (item.href === "/audit-logs") {
          return can("audit_logs:read");
        }
        if (item.href === "/payment-links") {
          return can("contributions:read");
        }
        if (item.href === "/import") {
          return can("members:write");
        }
        if (item.href === "/migration") {
          return can("org_settings:write");
        }
        if (item.href.startsWith("/attendance")) {
          return can("attendance:read");
        }
        if (item.href.startsWith("/meetings")) {
          return can("meetings:read");
        }
        if (item.href.startsWith("/inbox")) {
          return can("messages:read");
        }
        return true;
      })
    : navItems;

  const orgLabel =
    session?.orgName || session?.org_id || "(setup required)";

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-72 border-r border-slate-200 bg-white lg:block">
          <div className="border-b border-slate-200 px-6 py-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
              Unestra
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">SaaS Portal</h1>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Desktop-parity workflows for members, dues, fundraising, and setup.
            </p>
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
                  pathname === "/admin/platform"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-800 hover:bg-slate-100"
                }`}
              >
                Platform Admin
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
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/dashboard"
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                >
                  Dashboard
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
