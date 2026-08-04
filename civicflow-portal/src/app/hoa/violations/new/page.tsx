import { getHoaViolationsPageGate } from "@/lib/hoa/violations-guard";
import { listProperties } from "@/lib/hoa/properties";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { Breadcrumbs } from "@/components/admin/OperationsUI";
import { ViolationForm } from "@/components/hoa/ViolationForm";

export default async function NewHoaViolationPage() {
  const { organizationId, access } = await getHoaViolationsPageGate(PERMISSIONS.HOA_VIOLATIONS_WRITE);

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Record Violation" description="Not available for this organization." />
      </main>
    );
  }

  const { properties } = await listProperties(organizationId, { status: "ACTIVE", take: 200 });

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ href: "/hoa/violations", label: "Violations" }, { label: "Record violation" }]} />
      <PageHeader title="Record a violation" description="Creates a draft you can review before issuing a notice to the resident." />
      <SectionCard title="New violation">
        {properties.length === 0 ? (
          <p className="text-sm text-slate-600">
            No active properties exist yet. <a href="/hoa/properties/new" className="font-semibold text-emerald-700 hover:underline">Add a property</a> first.
          </p>
        ) : (
          <ViolationForm
            properties={properties.map((p) => ({
              id: p.id,
              label: p.displayName || (p.unitLabel ? `${p.addressLine1}, ${p.unitLabel}` : p.addressLine1),
            }))}
          />
        )}
      </SectionCard>
    </main>
  );
}
