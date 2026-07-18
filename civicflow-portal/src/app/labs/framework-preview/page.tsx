import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { getOrganizationLabAccess } from "@/lib/labs/access";
import { FrameworkPreviewPanel } from "@/components/labs/FrameworkPreviewPanel";

export default async function LabsFrameworkPreviewPage() {
  const { organizationId } = await requirePermission("labs:read");

  const access = await getOrganizationLabAccess(organizationId, "labsFrameworkPreview");

  return (
    <main className="space-y-6">
      <PageHeader
        title="Labs Framework Preview"
        description="Internal-only proof that Unestra Labs enrollment, entitlement, and permission checks work end to end."
        actions={[{ href: "/dashboard", label: "Back to Dashboard" }]}
      />

      {access.available ? (
        <FrameworkPreviewPanel />
      ) : (
        <SectionCard title="Not available" description="This organization does not currently have access to this internal preview feature.">
          <p className="text-sm text-slate-700">
            Reason: <code className="rounded bg-slate-100 px-1">{access.denialReason}</code>
          </p>
        </SectionCard>
      )}
    </main>
  );
}
