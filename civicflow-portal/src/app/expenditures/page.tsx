import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatCurrency } from "@/lib/formatting";
import { listExpenditures, getOrganizationCommitteeOptions, type ExpenditureListFilters } from "@/lib/expenditures";
import { ExpenditureFilterForm, ExpenditureLedgerTable } from "@/components/expenditures/ExpenditureLedgerTable";
import { prisma } from "@/lib/prisma";

export default async function ExpendituresPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { organizationId, session } = await requirePermission("expenditures:read");
  const params = await searchParams;

  const filters: ExpenditureListFilters = {
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    categoryId: params.categoryId,
    paymentMethodId: params.paymentMethodId,
    committeeId: params.committeeId,
    vendor: params.vendor,
    status: params.status === "ACTIVE" || params.status === "VOIDED" ? params.status : undefined,
    origin: params.origin === "DIRECT" || params.origin === "REIMBURSEMENT" ? params.origin : undefined,
  };

  const [rows, categories, paymentMethods, committees] = await Promise.all([
    listExpenditures(organizationId, filters),
    prisma.category.findMany({ where: { organizationId, type: "EXPENDITURE", isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.paymentMethodConfig.findMany({ where: { organizationId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }], select: { id: true, label: true } }),
    getOrganizationCommitteeOptions(organizationId, session.primaryVertical ?? "COMMUNITY"),
  ]);

  const activeRows = rows.filter((row) => !row.voidedAt);
  const totalSpent = activeRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const categoryCount = new Set(rows.map((row) => row.category).filter(Boolean)).size;

  return (
    <main className="space-y-6">
      <PageHeader
        title="Expenditures"
        description="Outgoing spending records scoped to the active organization."
        actions={[
          { href: "/expenditures/new", label: "Add Expenditure", tone: "primary" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Expenditures" value={rows.length} />
        <StatCard label="Total Spent (active)" value={formatCurrency(totalSpent)} />
        <StatCard label="Expense Categories" value={categoryCount} />
      </div>

      <SectionCard title="Filters" description="Every filter is reflected in the URL, so a filtered view can be bookmarked, refreshed, or shared.">
        <ExpenditureFilterForm
          basePath="/expenditures"
          categories={categories.map((c) => ({ id: c.id, label: c.name }))}
          paymentMethods={paymentMethods.map((p) => ({ id: p.id, label: p.label }))}
          committees={committees}
          current={params}
        />
      </SectionCard>

      <SectionCard title="Expense Ledger" description="Vendor, category, amount, and supporting detail for recent expenditures.">
        <ExpenditureLedgerTable rows={rows} basePath="/expenditures" />
      </SectionCard>
    </main>
  );
}
