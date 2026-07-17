import type { ReactNode } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { OperationsCenterNav } from "@/components/admin/OperationsCenterNav";

export default async function PlatformOperationsLayout({ children }: { children: ReactNode }) {
  // Defense-in-depth: every individual page under /admin/platform also
  // calls requireSuperAdmin() itself (see Phase 16 authorization tests) —
  // this layout-level check means the shell chrome itself never renders
  // for an unauthorized request either.
  await requireSuperAdmin();

  const session = await getServerSession(authOptions);
  const isProduction = process.env.NODE_ENV === "production";

  return (
    <div className="-mx-4 -my-6 md:-mx-6">
      <header className="border-b border-slate-200 bg-slate-950 text-white">
        <div className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">Unestra Platform Operations</p>
            <h1 className="text-xl font-semibold text-white">APH Operations Center</h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            {/* This distinction is deliberately explicit and separate — platform
                role must never be presented as if it were the active org's role. */}
            <div>
              <p className="text-slate-400">Platform role</p>
              <p className="font-semibold text-emerald-400">{session?.platformRoles?.join(", ") || "SUPER_ADMIN"}</p>
            </div>
            <div>
              <p className="text-slate-400">Active organization</p>
              <p className="font-semibold text-white">{session?.orgName ?? "None selected"}</p>
            </div>
            <div>
              <p className="text-slate-400">Signed in as</p>
              <p className="font-semibold text-white">{session?.userEmail}</p>
            </div>
            {!isProduction ? (
              <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-amber-300">
                {process.env.NODE_ENV ?? "development"} environment
              </span>
            ) : null}
            <Link
              href="/dashboard"
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-900"
            >
              ← Back to organization portal
            </Link>
          </div>
        </div>
      </header>

      <OperationsCenterNav />

      <div className="space-y-6 px-4 py-6 md:px-6">{children}</div>
    </div>
  );
}
