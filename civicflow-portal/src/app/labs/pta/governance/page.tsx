import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { listGovernanceDocuments } from "@/lib/governance-documents";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { PtaGovernanceLibrary } from "@/components/labs/pta/PtaGovernanceLibrary";

/**
 * PTA Vertical 2.0, PR PTA-D — "Bylaws & Policies" (PTA language, never model
 * names). Versioned governing documents: publishing a new version supersedes
 * the old one automatically; nothing is ever deleted.
 */
export default async function PtaGovernancePage() {
  const { organizationId, access, can } = await getPtaPageGate("governance:read");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Bylaws & Policies" description="Not available for this organization." />
      </main>
    );
  }

  const groups = await listGovernanceDocuments(organizationId);

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Bylaws & Policies"
        description="Your PTA's governing documents — bylaws, standing rules, policies, and resolutions — with their complete amendment history. Superseded versions are kept forever."
      />
      <SectionCard title="Governance library" description={`${groups.length} document(s).`}>
        <PtaGovernanceLibrary
          groups={groups.map((group) => ({
            groupId: group.groupId,
            docType: group.docType,
            title: group.title,
            current: group.current
              ? {
                  id: group.current.id,
                  version: group.current.version,
                  status: group.current.status,
                  effectiveDate: group.current.effectiveDate?.toISOString() ?? null,
                  approvedDate: group.current.approvedDate?.toISOString() ?? null,
                  reviewDate: group.current.reviewDate?.toISOString() ?? null,
                  fileName: group.current.fileName,
                  notes: group.current.notes,
                }
              : null,
            versions: group.versions.map((version) => ({
              id: version.id,
              version: version.version,
              status: version.status,
              effectiveDate: version.effectiveDate?.toISOString() ?? null,
              approvedDate: version.approvedDate?.toISOString() ?? null,
              reviewDate: version.reviewDate?.toISOString() ?? null,
              fileName: version.fileName,
              notes: version.notes,
            })),
          }))}
          canWrite={can("governance:write")}
        />
      </SectionCard>
    </main>
  );
}
