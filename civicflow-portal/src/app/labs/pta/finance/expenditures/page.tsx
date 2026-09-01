import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatCurrency } from "@/lib/formatting";
import { listExpenditures, getOrganizationCommitteeOptions, type ExpenditureListFilters } from "@/lib/expenditures";
import { ExpenditureFilterForm, ExpenditureLedgerTable } from "@/components/expenditures/ExpenditureLedgerTable";
import { prisma } from "@/lib/prisma";

const BASE_PATH = "/labs/pta/finance/expenditures";

export default async function TreasurerExpendituresPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { organizationId, access, can } = await getPtaPageGate("expenditures:read");
  if (!access.available) return null;
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
    getOrganizationCommitteeOptions(organizationId, "PTA"),
  ]);

  const activeRows = rows.filter((row) => !row.voidedAt);
  const totalSpent = activeRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const categoryCount = new Set(rows.map((row) => row.category).filter(Boolean)).size;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenditures"
        description="The same expenditure ledger the Treasurer overview and budget actuals read from."
        actions={can("expenditures:write") ? [{ href: `${BASE_PATH}/new`, label: "Add Expenditure", tone: "primary" }] : []}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Expenditures" value={rows.length} />
        <StatCard label="Total Spent (active)" value={formatCurrency(totalSpent)} />
        <StatCard label="Expense Categories" value={categoryCount} />
      </div>
      <SectionCard title="Filters" description="Every filter is reflected in the URL, so a filtered view can be bookmarked, refreshed, or shared.">
        <ExpenditureFilterForm
          basePath={BASE_PATH}
          categories={categories.map((c) => ({ id: c.id, label: c.name }))}
          paymentMethods={paymentMethods.map((p) => ({ id: p.id, label: p.label }))}
          committees={committees}
          current={params}
        />
      </SectionCard>
      <SectionCard title="Expense Ledger" description="Vendor, category, committee, amount, and supporting detail for recent expenditures.">
        <ExpenditureLedgerTable rows={rows} basePath={BASE_PATH} reimbursementsBasePath="/labs/pta/finance/reimbursements" />
      </SectionCard>
    </div>
  );
}
