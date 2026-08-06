import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { ImportBatchDetail } from "@/components/import/ImportBatchDetail";

export default async function ImportBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId, can } = await requirePermission("imports:read");
  const { id } = await params;

  const batch = await prisma.importBatch.findFirst({ where: { id, organizationId } });

  if (!batch) {
    return (
      <main className="space-y-6">
        <PageHeader title="Import not found" actions={[{ href: "/imports", label: "Back to Import History" }]} />
      </main>
    );
  }

  const rows = await prisma.importRow.findMany({
    where: { batchId: id },
    orderBy: { rowNumber: "asc" },
    take: 200,
  });

  return (
    <main className="space-y-6">
      <PageHeader
        title={batch.fileName}
        description={`Uploaded ${batch.uploadedAt.toLocaleString()}`}
        actions={[{ href: "/imports", label: "Back to Import History" }]}
      />

      <SectionCard title="Overview">
        <ImportBatchDetail
          batchId={batch.id}
          initialBatch={{
            status: batch.status,
            totalRows: batch.totalRows,
            newCount: batch.newCount,
            duplicateCount: batch.duplicateCount,
            updateCount: batch.updateCount,
            invalidCount: batch.invalidCount,
            importedCount: batch.importedCount,
            skippedCount: batch.skippedCount,
            blockedPlanLimitCount: batch.blockedPlanLimitCount,
            planLimitSnapshot: batch.planLimitSnapshot as { allowed: number; used: number; pendingAfterUpgrade: number } | null,
          }}
          initialRows={rows.map((row) => ({
            id: row.id,
            rowNumber: row.rowNumber,
            normalizedData: row.normalizedData as { firstName: string; lastName: string; email: string | null },
            status: row.status,
            decision: row.decision,
            errorMessage: row.errorMessage,
          }))}
          canResume={can("imports:resume")}
          canCancel={can("imports:cancel")}
          canReview={can("imports:review")}
          canResolveDuplicates={can("imports:resolve-duplicates")}
        />
      </SectionCard>
    </main>
  );
}
