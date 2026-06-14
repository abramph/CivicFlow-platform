import { requirePermission } from "@/lib/auth-guards";
import { getDuesPaymentFormOptions } from "@/lib/dues-payment-options";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { DuesPaymentCreateForm } from "@/components/forms/DuesPaymentCreateForm";

function getValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function NewDuesPaymentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await requirePermission("dues:write");
  const resolvedSearchParams = await searchParams;
  const options = await getDuesPaymentFormOptions(organizationId);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Record Dues Payment"
        description="Apply a payment to a member, dues charge, or dues account with configured organization payment methods."
        actions={[
          { href: "/dues/payments", label: "Back to Dues Payments" },
          { href: "/dues", label: "Back to Dues" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />
      <SectionCard title="Payment Details" description="Member and organization context are validated server-side before posting.">
        <DuesPaymentCreateForm
          {...options}
          defaults={{
            memberId: getValue(resolvedSearchParams.memberId),
            chargeId: getValue(resolvedSearchParams.chargeId) || getValue(resolvedSearchParams.duesChargeId),
            accountId: getValue(resolvedSearchParams.accountId) || getValue(resolvedSearchParams.duesAccountId),
          }}
        />
      </SectionCard>
    </main>
  );
}

