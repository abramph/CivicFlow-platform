import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PaymentImportCreateForm } from "@/components/forms/PaymentImportCreateForm";

export default async function NewPaymentImportPage() {
  await requirePermission("dues:write");
  return (
    <main className="space-y-6">
      <PageHeader
        title="Import Electronic Payments"
        description="Upload a CSV export from Zelle, Cash App, Venmo, PayPal, Stripe, or a bank file. Common headers are auto-detected."
        actions={[
          { href: "/payments/imports", label: "Back to Imports" },
          { href: "/payments/reconciliation", label: "Manual Reconciliation" },
        ]}
      />
      <SectionCard title="CSV Import" description="Supported columns include date, payer name/email/phone, amount, memo/description, and transaction id.">
        <PaymentImportCreateForm />
      </SectionCard>
    </main>
  );
}
