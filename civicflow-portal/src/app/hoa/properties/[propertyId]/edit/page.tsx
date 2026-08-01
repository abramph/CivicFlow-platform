import { getHoaPageGate } from "@/lib/hoa/guard";
import { getProperty } from "@/lib/hoa/properties";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { Breadcrumbs } from "@/components/admin/OperationsUI";
import { PropertyEditForm } from "@/components/hoa/PropertyEditForm";

function propertyLabel(p: { addressLine1: string; unitLabel: string | null; displayName: string | null }) {
  if (p.displayName) return p.displayName;
  return p.unitLabel ? `${p.addressLine1}, ${p.unitLabel}` : p.addressLine1;
}

export default async function EditHoaPropertyPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const { organizationId, access } = await getHoaPageGate(PERMISSIONS.HOA_PROPERTIES_WRITE);

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Edit Property" description="Not available for this organization." />
      </main>
    );
  }

  const { propertyId } = await params;
  const property = await getProperty(organizationId, propertyId);

  return (
    <main className="space-y-6">
      <Breadcrumbs
        items={[
          { href: "/hoa/properties", label: "Properties" },
          { href: `/hoa/properties/${property.id}`, label: propertyLabel(property) },
          { label: "Edit" },
        ]}
      />
      <PageHeader title={`Edit ${propertyLabel(property)}`} />
      <SectionCard title="Property details">
        <PropertyEditForm property={property} />
      </SectionCard>
    </main>
  );
}
