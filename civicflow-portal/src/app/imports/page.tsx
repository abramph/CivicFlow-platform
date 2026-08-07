import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { getVerticalCapabilities } from "@/lib/vertical-capabilities";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { StatusBadge } from "@/components/app/StatusBadge";

const KIND_LABEL: Record<string, string> = {
  COMMUNITY_MEMBERS: "Members",
  PTA_HOUSEHOLDS: "PTA Households",
  HOA_PROPERTIES: "HOA Properties",
};

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

  const [batches, organization] = await Promise.all([
    prisma.importBatch.findMany({ where: { organizationId }, orderBy: { uploadedAt: "desc" }, take: 100 }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { primaryVertical: true } }),
  ]);
  const capabilities = getVerticalCapabilities(organization?.primaryVertical ?? "COMMUNITY");

  const actions: { href: string; label: string; tone?: "primary" }[] = [];
  if (can("imports:create")) {
    if (can("members:write")) actions.push({ href: "/imports/new", label: "Import Members (Beta)", tone: "primary" });
    if (capabilities.ptaHouseholds && can("pta:households:manage")) {
      actions.push({ href: "/imports/new?kind=PTA_HOUSEHOLDS", label: "Import PTA Households (Beta)" });
    }
    if (capabilities.properties && can("hoa:properties:write") && can("hoa:residents:write")) {
      actions.push({ href: "/imports/new?kind=HOA_PROPERTIES", label: "Import HOA Properties (Beta)" });
    }
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title="Import History"
        description="Resumable imports — a paused batch (e.g. from reaching your plan's member limit) can be resumed after upgrading, without starting over."
        actions={actions}
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
                  <th className="px-2 py-2">Type</th>
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
                    <td className="px-2 py-3 text-slate-700">{KIND_LABEL[batch.importKind] ?? batch.importKind}</td>
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
