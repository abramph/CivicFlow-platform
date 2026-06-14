"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/LogoutButton";
import { canDo } from "@/lib/rbac";

function isHiddenPath(pathname: string) {
  return pathname === "/login" || pathname === "/buy";
}

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/settings") return pathname === "/settings";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session, status } = useSession();

  if (isHiddenPath(pathname)) {
    return <>{children}</>;
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-900">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-700">Loading CivicFlow…</p>
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

  const saasNav = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/members", label: "Members" },
    { href: "/contributions", label: "Contributions" },
    { href: "/dues", label: "Dues" },
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
    { href: "/settings", label: "Settings" },
    { href: "/settings/categories", label: "Categories" },
    { href: "/settings/dues", label: "Dues Setup" },
    { href: "/settings/payment-methods", label: "Payment Methods" },
    { href: "/settings/users", label: "Users & Roles" },
    { href: "/settings/billing", label: "Billing" },
    { href: "/onboarding/organization", label: "Onboarding" },
    { href: "/migration", label: "Migration" },
  ];

  const legacyNav = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/payments", label: "Payments" },
    { href: "/settings", label: "Settings" },
  ];

  const navItems = hasSaasSession ? saasNav : legacyNav;
  const canSeePlatformAdmin =
    hasSaasSession && session?.role === "SUPER_ADMIN";

  const visibleNavItems = hasSaasSession
    ? navItems.filter((item) => {
        if (item.href.startsWith("/settings/categories")) {
          return canDo(session?.role ?? "READ_ONLY", "org_settings:read");
        }
        if (item.href.startsWith("/settings/dues")) {
          return canDo(session?.role ?? "READ_ONLY", "dues:read");
        }
        if (item.href.startsWith("/settings/payment-methods")) {
          return canDo(session?.role ?? "READ_ONLY", "org_settings:read");
        }
        if (item.href.startsWith("/settings/users")) {
          return canDo(session?.role ?? "READ_ONLY", "users:read");
        }
        if (item.href.startsWith("/settings/billing")) {
          return canDo(session?.role ?? "READ_ONLY", "billing:read");
        }
        if (item.href.startsWith("/communications")) {
          return canDo(session?.role ?? "READ_ONLY", "communications:read");
        }
        if (item.href.startsWith("/payments/imports") || item.href.startsWith("/payments/reconciliation")) {
          return canDo(session?.role ?? "READ_ONLY", "dues:read");
        }
        if (item.href === "/migration") {
          return canDo(session?.role ?? "READ_ONLY", "org_settings:write");
        }
        if (item.href.startsWith("/attendance")) {
          return canDo(session?.role ?? "READ_ONLY", "attendance:read");
        }
        if (item.href.startsWith("/meetings")) {
          return canDo(session?.role ?? "READ_ONLY", "meetings:read");
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
              CivicFlow
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
                  isActive(pathname, "/admin/platform")
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-800 hover:bg-slate-100"
                }`}
              >
                Platform Admin
              </Link>
            ) : null}
          </nav>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          <header className="border-b border-slate-200 bg-white">
            <div className="flex flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600">Organization</p>
                <p className="text-lg font-semibold text-slate-950">{orgLabel}</p>
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
