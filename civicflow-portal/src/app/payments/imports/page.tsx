import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDateTime, formatEnumLabel } from "@/lib/formatting";

export default async function PaymentImportsPage() {
  const { organizationId } = await requirePermission("dues:read");
  const batches = await prisma.paymentImportBatch.findMany({
    where: { organizationId },
    orderBy: { uploadedAt: "desc" },
    include: { _count: { select: { items: true } } },
    take: 100,
  });
  return (
    <main className="space-y-6">
      <PageHeader
        title="Payment Imports"
        description="Import electronic payments from Zelle, Cash App, Venmo, PayPal, Stripe, bank exports, or manual CSV files."
        actions={[
          { href: "/payments/imports/new", label: "Import Payments", tone: "primary" },
          { href: "/payments/reconciliation", label: "Manual Reconciliation" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Batches" value={batches.length} />
        <StatCard label="Parsed" value={batches.filter((batch) => batch.status === "PARSED").length} />
        <StatCard label="Posted" value={batches.filter((batch) => batch.status === "POSTED").length} />
      </div>
      <SectionCard title="Import Batches" description="Imported raw records are retained for audit and reconciliation.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr><th className="px-4 py-3">Uploaded</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">File</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Items</th></tr>
            </thead>
            <tbody>
              {batches.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-600">No payment imports yet.</td></tr> : batches.map((batch) => (
                <tr key={batch.id} className="border-t border-slate-100">
                  <td className="px-4 py-3"><Link href={`/payments/imports/${batch.id}`} className="font-semibold text-emerald-700 hover:underline">{formatDateTime(batch.uploadedAt)}</Link></td>
                  <td className="px-4 py-3">{formatEnumLabel(batch.sourceType)}</td>
                  <td className="px-4 py-3">{batch.fileName || "-"}</td>
                  <td className="px-4 py-3">{formatEnumLabel(batch.status)}</td>
                  <td className="px-4 py-3">{batch._count.items}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
