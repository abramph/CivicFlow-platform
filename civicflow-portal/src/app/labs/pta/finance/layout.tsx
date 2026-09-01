import type { ReactNode } from "react";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { PageHeader } from "@/components/app/PageChrome";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { TreasurerTabs } from "@/components/labs/pta/TreasurerTabs";

/**
 * feature/pta-treasurer-expenditure-experience (E1) — the Treasurer shell.
 * budget:read is the same permission that already gates the top-level
 * "Treasurer" nav item in vertical-navigation.ts, and every role that holds
 * any of expenditures:read/write, reimbursements:submit/manage also holds
 * budget:read (see rbac.ts) — so this check is a safe, non-excluding outer
 * gate. Each section underneath additionally checks its OWN specific
 * permission (expenditures:read for the ledger, etc.), so a user who can
 * reach the shell but lacks a given section's permission is still stopped,
 * server-side, at that section.
 */
export default async function TreasurerLayout({ children }: { children: ReactNode }) {
  const { access, can } = await getPtaPageGate("budget:read");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Treasurer" description="Not available for this organization." />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Treasurer"
        description="Your PTA's operating finances: overview, budget vs. actual, the expenditure ledger, and reimbursements. Unestra never stores bank credentials — marking a reimbursement paid, or recording a direct expenditure's payment method, records a payment made outside Unestra."
      />
      <TreasurerTabs canReadExpenditures={can("expenditures:read")} />
      {children}
    </main>
  );
}
