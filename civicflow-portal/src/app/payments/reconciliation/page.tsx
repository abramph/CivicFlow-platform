import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PaymentImportCreateForm } from "@/components/forms/PaymentImportCreateForm";

export default async function PaymentReconciliationPage() {
  await requirePermission("dues:write");
  return (
    <main className="space-y-6">
      <PageHeader title="Payment Reconciliation" description="Manually enter or paste verified electronic payment rows, then match and post them to member records." actions={[{ href: "/payments/imports", label: "Payment Imports" }, { href: "/dashboard", label: "Back to Dashboard" }]} />
      <SectionCard title="Manual Electronic Payment Entry" description="For Zelle, Cash App, Venmo, PayPal, and Stripe payments verified outside Unestra, paste a small CSV and continue to review/post.">
        <PaymentImportCreateForm />
      </SectionCard>
    </main>
  );
}
