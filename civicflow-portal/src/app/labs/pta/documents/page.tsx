import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { PageHeader } from "@/components/app/PageChrome";
import { EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";

/**
 * No PTA-specific document model or API exists (bylaws, budget PDFs, permission
 * slips, etc.) — this is an honest placeholder per the UI integration sprint's
 * explicit instruction not to invent document management that doesn't exist
 * on the backend. Meeting minutes already have their own page/API (see
 * minutes.ts) and are not duplicated here.
 */
export default async function PtaDocumentsPage() {
  const { access } = await getPtaPageGate("pta:documents:manage");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Documents" description="Not available for this organization." />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader title="Documents" description="Shared files for your PTA — bylaws, budgets, permission slips, and the like." />
      <EmptyState
        title="Not built yet"
        description="Document storage doesn't exist in this vertical yet — this page is a placeholder marking a planned feature, not a hidden or broken one. Approved meeting minutes already have their own page; everything else (bylaws, budgets, forms) will land here in a future phase."
      />
    </main>
  );
}
