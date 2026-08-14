import { Suspense } from "react";
import { requirePermission } from "@/lib/auth-guards";
import { getAccountView } from "@/lib/payments/stripe-connect";
import { getGivingSettings } from "@/lib/giving/module";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { StripePaymentsCard } from "@/components/payments/StripePaymentsCard";

/**
 * CONNECT-B (§24) — Settings → Payments → Stripe. Status, requirements,
 * and the Stripe-hosted onboarding hand-off. Not a fake Stripe dashboard:
 * account management happens at Stripe (Standard accounts own their own
 * dashboard).
 */
export default async function PaymentsSettingsPage() {
  const { organizationId, can } = await requirePermission("payments:stripe:view");
  const [view, giving] = await Promise.all([getAccountView(organizationId), getGivingSettings(organizationId)]);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Payments"
        description="Your organization connects directly to Stripe. Payments collected from your members or supporters are processed for your organization and paid to your Stripe account — Unestra never holds your money."
      />
      {giving.contributionsEnabled && !view?.chargesEnabled ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          Payments Setup Required — Contributions &amp; Giving is enabled, but this organization cannot accept online
          payments until Stripe setup is complete.
        </div>
      ) : null}
      <SectionCard
        title="Stripe Payments"
        description="Stripe collects and verifies your organization's identity, banking, and tax details — Unestra never sees or stores them."
      >
        <Suspense fallback={null}>
        <StripePaymentsCard
          view={
            view
              ? {
                  statusLabel: view.statusLabel,
                  onboardingStatus: view.onboardingStatus,
                  chargesEnabled: view.chargesEnabled,
                  payoutsEnabled: view.payoutsEnabled,
                  requirementsCurrentlyDueCount: view.requirementsCurrentlyDueCount,
                  connectedAt: view.connectedAt?.toISOString() ?? null,
                  lastSyncedAt: view.lastSyncedAt?.toISOString() ?? null,
                  disabled: Boolean(view.disabledAt),
                  accountMode: view.accountMode,
                }
              : null
          }
          viewer={{ canConnect: can("payments:stripe:connect"), canRefresh: can("payments:stripe:refresh") }}
        />
        </Suspense>
      </SectionCard>
    </main>
  );
}
