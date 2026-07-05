import { requirePermission } from "@/lib/auth-guards";
import { ensureDefaultPaymentMethods } from "@/lib/payment-methods";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { PaymentMethodsManager } from "@/components/forms/PaymentMethodsManager";

export default async function PaymentMethodsSettingsPage() {
  const { organizationId, can } = await requirePermission("org_settings:read");
  const canWrite = can("org_settings:write");

  await ensureDefaultPaymentMethods(prisma, organizationId);

  const methods = await prisma.paymentMethodConfig.findMany({
    where: { organizationId },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });

  return (
    <main className="space-y-6">
      <PageHeader
        title="Payment Methods"
        description="Configure the payment methods your organization accepts for contributions, dues, and receipts."
        actions={[
          { href: "/settings", label: "Settings Hub" },
          { href: "/settings/dues", label: "Dues Setup" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Configured Methods" value={methods.length} />
        <StatCard label="Active Methods" value={methods.filter((method) => method.isActive).length} />
        <StatCard label="Digital Wallets" value={methods.filter((method) => ["ZELLE", "CASH_APP", "VENMO", "PAYPAL"].includes(method.method)).length} />
      </div>

      <SectionCard title="Accepted Payment Methods" description="Labels and instructions shown on payment entry forms are organization-scoped.">
        <PaymentMethodsManager methods={methods} canWrite={canWrite} />
      </SectionCard>
    </main>
  );
}

