import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { ImportBatchDetail } from "@/components/import/ImportBatchDetail";
import { attachFieldComparisons } from "@/lib/imports/duplicate-matching";
import { formatRowIdentity } from "@/lib/imports/row-normalization";
import { authorizeImportKindRead } from "@/lib/imports/authorization";

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

  try {
    authorizeImportKindRead(batch.importKind, can);
  } catch {
    redirect("/imports?error=forbidden");
  }

  const rows = await prisma.importRow.findMany({
    where: { batchId: id },
    orderBy: { rowNumber: "asc" },
    take: 200,
  });
  const rowsWithComparison = await attachFieldComparisons(rows, organizationId, batch.importKind);

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
          initialRows={rowsWithComparison.map((row) => ({
            id: row.id,
            rowNumber: row.rowNumber,
            ...formatRowIdentity(batch.importKind, row.normalizedData),
            status: row.status,
            decision: row.decision,
            errorMessage: row.errorMessage,
            matchedRecordLabel: row.matchedRecordLabel,
            fieldComparison: row.fieldComparison,
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
