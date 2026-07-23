import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { listRecentImpersonationSessions } from "@/lib/platform-operations/impersonation";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { Breadcrumbs, EmptyState } from "@/components/admin/OperationsUI";
import { formatDateTime } from "@/lib/formatting";

function describe(action: string, metadata: unknown): string {
  const m = (metadata ?? {}) as Record<string, unknown>;
  if (action === "platform.impersonation.started") {
    const name = (m.targetDisplayName as string | undefined) ?? (m.targetEmail as string | undefined) ?? "a user";
    return `Started impersonating ${name}${m.reason ? ` — "${m.reason}"` : ""}`;
  }
  if (action === "platform.impersonation.ended") {
    const minutes = typeof m.durationMs === "number" ? Math.round(m.durationMs / 60000) : null;
    return `Ended impersonation${minutes !== null ? ` (${minutes} min)` : ""}`;
  }
  return action;
}

export default async function PlatformImpersonationHistoryPage() {
  await requireSuperAdmin();
  const events = await listRecentImpersonationSessions(100);

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ href: "/admin/platform", label: "Overview" }, { label: "Impersonation history" }]} />
      <PageHeader
        title="Impersonation history"
        description="Every impersonation session started or ended by a Platform Administrator, across all organizations. See also the full Audit Events log for the underlying raw records."
        actions={[{ href: "/admin/platform/audit", label: "Full audit log" }]}
      />
      <SectionCard title="Recent sessions" description={`${events.length} event(s).`}>
        {events.length === 0 ? (
          <EmptyState title="No impersonation sessions yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <p className="font-semibold text-slate-900">{describe(e.action, e.metadata)}</p>
                  <p className="text-slate-600">
                    {e.actorEmail ?? "unknown admin"}
                    {e.organizationName ? (
                      <>
                        {" · "}
                        <Link href={`/admin/platform/organizations/${e.organizationId}`} className="text-emerald-700 hover:underline">
                          {e.organizationName}
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
                <p className="shrink-0 text-slate-500">{formatDateTime(e.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </main>
  );
}
