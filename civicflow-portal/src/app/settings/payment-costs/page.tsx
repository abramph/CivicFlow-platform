import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PaymentCostPolicyManager } from "@/components/payments/PaymentCostPolicyManager";
import { COST_POLICY_VERSION } from "@/lib/payments/cost-policy";

/**
 * LAUNCH-SAFE §1 — organization payment-cost policy (docs/
 * payment-cost-policy-v2.md). Viewable with the summary capability; every
 * change requires funds-manage (enforced by the API, mirrored in the UI).
 */
export default async function PaymentCostPolicyPage() {
  const { organizationId, can } = await requirePermission("contributions:summary:view");

  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId },
    select: {
      paymentCostPolicyV2Enabled: true,
      fixedObligationCoveragePolicy: true,
      voluntaryCoveragePolicy: true,
      fixedObligationPaymentPreference: true,
      achEnabled: true,
      policyAcceptedAt: true,
      policyVersion: true,
    },
  });

  return (
    <main className="space-y-6">
      <PageHeader
        title="Payment costs"
        description="Who bears card-processing costs, and how members pay obligations online. Whatever you choose here, a member who pays their stated amount is always credited that full amount."
      />
      <SectionCard
        title="Policy"
        description="These choices apply to online payments through your organization's own connected Stripe account. Offline payments (cash, check, payroll deduction) never carry an online processing cost."
      >
        <PaymentCostPolicyManager
          settings={{
            paymentCostPolicyV2Enabled: settings?.paymentCostPolicyV2Enabled ?? false,
            fixedObligationCoveragePolicy: settings?.fixedObligationCoveragePolicy ?? "ORGANIZATION_ABSORBS",
            voluntaryCoveragePolicy: settings?.voluntaryCoveragePolicy ?? "OPTIONAL",
            fixedObligationPaymentPreference: settings?.fixedObligationPaymentPreference ?? "CARD_AND_ABSORB",
            achEnabled: settings?.achEnabled ?? false,
            policyAcceptedAt: settings?.policyAcceptedAt?.toISOString() ?? null,
            policyVersion: settings?.policyVersion ?? null,
            currentPolicyVersion: COST_POLICY_VERSION,
          }}
          canManage={can("contributions:funds:manage")}
        />
      </SectionCard>
    </main>
  );
}
