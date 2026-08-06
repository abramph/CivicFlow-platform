import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { StatusBadge } from "@/components/app/StatusBadge";

const STATUS_TONE: Record<string, "positive" | "caution" | "critical" | "neutral"> = {
  UPLOADED: "neutral",
  ANALYZING: "neutral",
  READY_FOR_REVIEW: "caution",
  IMPORTING: "caution",
  PARTIALLY_COMPLETED: "caution",
  PAUSED_PLAN_LIMIT: "critical",
  COMPLETED: "positive",
  FAILED: "critical",
  CANCELED: "neutral",
};

export default async function ImportsPage() {
  const { organizationId, can } = await requirePermission("imports:read");

  const batches = await prisma.importBatch.findMany({
    where: { organizationId },
    orderBy: { uploadedAt: "desc" },
    take: 100,
  });

  return (
    <main className="space-y-6">
      <PageHeader
        title="Import History"
        description="Resumable member imports — a paused batch (e.g. from reaching your plan's member limit) can be resumed after upgrading, without starting over."
        actions={can("imports:create") ? [{ href: "/imports/new", label: "Import Members (Beta)", tone: "primary" }] : []}
      />

      <SectionCard title="Batches" description="Sorted by most recent upload.">
        {batches.length === 0 ? (
          <p className="text-sm text-slate-600">No imports yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">File</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Rows</th>
                  <th className="px-2 py-2">Imported</th>
                  <th className="px-2 py-2">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-2 py-3">
                      <Link href={`/imports/${batch.id}`} className="font-medium text-emerald-700 hover:underline">
                        {batch.fileName}
                      </Link>
                    </td>
                    <td className="px-2 py-3">
                      <StatusBadge label={batch.status.replaceAll("_", " ")} tone={STATUS_TONE[batch.status] ?? "neutral"} />
                    </td>
                    <td className="px-2 py-3 text-slate-700">{batch.totalRows}</td>
                    <td className="px-2 py-3 text-slate-700">{batch.importedCount}</td>
                    <td className="px-2 py-3 text-slate-600">{batch.uploadedAt.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </main>
  );
}
