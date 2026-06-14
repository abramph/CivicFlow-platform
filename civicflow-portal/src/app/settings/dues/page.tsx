import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { CategoryManager } from "@/components/forms/CategoryManager";
import { DuesGenerateForm } from "@/components/forms/DuesGenerateForm";
import { DuesPolicySettingsForm } from "@/components/forms/DuesPolicySettingsForm";
import { RunCategoryRulesButton } from "@/components/forms/MembershipRuleActions";
import { formatCurrency, formatEnumLabel, formatText } from "@/lib/formatting";

export default async function DuesSettingsPage() {
  const { organizationId } = await requirePermission("dues:read");

  const [categories, accounts, settings] = await Promise.all([
    prisma.category.findMany({
      where: {
        organizationId,
        type: {
          in: ["DUES", "MEMBERSHIP"],
        },
      },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      include: {
        standardDuesCategory: true,
        _count: {
          select: {
            members: true,
            duesAccounts: true,
          },
        },
      },
    }),
    prisma.duesAccount.findMany({
      where: { organizationId },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: {
        member: true,
        category: true,
        _count: {
          select: {
            charges: true,
          },
        },
      },
      take: 100,
    }),
    prisma.orgSettings.upsert({
      where: { organizationId },
      update: {},
      create: { organizationId },
    }),
  ]);

  const duesCategories = categories
    .filter((category) => category.type === "DUES")
    .map((category) => ({ id: category.id, name: category.name }));

  return (
    <main className="space-y-6">
      <PageHeader
        title="Dues Setup"
        description="Configure dues plans and the membership categories that should inherit those plans, then review current dues accounts."
        actions={[
          { href: "/dues/accounts", label: "Dues Accounts" },
          { href: "/dues/generate", label: "Generate Dues Charges", tone: "primary" },
          { href: "/settings/categories", label: "All Categories" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Dues Categories" value={duesCategories.length} />
        <StatCard label="Membership Categories" value={categories.filter((category) => category.type === "MEMBERSHIP").length} />
        <StatCard label="Dues Accounts" value={accounts.length} />
        <StatCard label="Active Accounts" value={accounts.filter((account) => account.isActive).length} />
      </div>

      <SectionCard title="Dues and Membership Categories" description="Use dues categories for plan defaults and membership categories for member classification plus standard dues linkage.">
        <div className="mb-5">
          <RunCategoryRulesButton />
        </div>
        <CategoryManager
          categories={categories.map((category) => ({
            ...category,
            amountDefault: category.amountDefault?.toString() ?? null,
            effectiveDate: category.effectiveDate?.toISOString() ?? null,
            memberCount: category._count.members,
            duesAccountCount: category._count.duesAccounts,
          }))}
          duesCategories={duesCategories}
          allowedTypes={["DUES", "MEMBERSHIP"]}
          initialType="DUES"
        />
      </SectionCard>

      <SectionCard title="Dues Policy and Financial Controls" description="Define accrual start, delinquency thresholds, reminder cadence, and protected financial edit behavior.">
        <DuesPolicySettingsForm
          settings={{
            duesStartRule: settings.duesStartRule,
            delinquentAfterMonths: settings.delinquentAfterMonths,
            delinquentAfterDays: settings.delinquentAfterDays,
            autoMarkDelinquent: settings.autoMarkDelinquent,
            gracePeriodDays: settings.gracePeriodDays,
            autoSuspendAfterMonths: settings.autoSuspendAfterMonths,
            autoDeactivateAfterMonths: settings.autoDeactivateAfterMonths,
            reminderFrequencyDays: settings.reminderFrequencyDays,
            financialEditWindowHours: settings.financialEditWindowHours,
            requireReasonForFinancialEdits: settings.requireReasonForFinancialEdits,
            allowFinanceCorrections: settings.allowFinanceCorrections,
            lockReceiptsAfterIssue: settings.lockReceiptsAfterIssue,
          }}
        />
      </SectionCard>

      <SectionCard title="Run Dues Evaluation" description="Generate missing charges from join dates and re-evaluate delinquency under the current policy.">
        <DuesGenerateForm />
      </SectionCard>

      <SectionCard title="Current Dues Accounts" description="A quick setup-oriented view of the dues accounts that currently exist and how they relate back to categories.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Frequency</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Charges</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-600">
                    No dues accounts have been created yet.
                  </td>
                </tr>
              ) : (
                accounts.map((account) => (
                  <tr key={account.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-950">
                      <Link href="/dues/accounts" className="font-semibold text-emerald-700 hover:underline">
                        {account.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-900">{formatText(account.category?.name, "No category")}</td>
                    <td className="px-4 py-3 text-slate-900">{account.member ? `${account.member.lastName}, ${account.member.firstName}` : "Shared"}</td>
                    <td className="px-4 py-3 text-slate-900">{formatEnumLabel(account.frequency)}</td>
                    <td className="px-4 py-3 text-slate-900">{formatCurrency(account.amountDefault)}</td>
                    <td className="px-4 py-3 text-slate-900">{account.isActive ? "Active" : "Inactive"}</td>
                    <td className="px-4 py-3 text-slate-900">{account._count.charges}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
