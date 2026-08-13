import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { PtaDocumentCenter } from "@/components/labs/pta/PtaDocumentCenter";

/**
 * PTA Vertical 2.0, PR PTA-D — the Document Center replaces the honest
 * placeholder this page used to be. Bylaws & Policies (versioned governing
 * documents) have their own dedicated page; this is the general repository.
 */
export default async function PtaDocumentsPage() {
  const { organizationId, access, can } = await getPtaPageGate("documents:read");

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
      <PageHeader
        title="Documents"
        description="Your PTA's shared files, organized by folder. Files belong to the organization — they stay when officers change. Bylaws and policies live in Bylaws & Policies."
      />
      <SectionCard title="Document Center">
        <PtaDocumentCenter organizationId={organizationId} canWrite={can("documents:write")} />
      </SectionCard>
    </main>
  );
}
