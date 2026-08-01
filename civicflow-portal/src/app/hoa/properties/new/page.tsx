import { getHoaPageGate } from "@/lib/hoa/guard";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { Breadcrumbs } from "@/components/admin/OperationsUI";
import { PropertyForm } from "@/components/hoa/PropertyForm";

export default async function NewHoaPropertyPage() {
  const { access } = await getHoaPageGate(PERMISSIONS.HOA_PROPERTIES_WRITE);

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Add Property" description="Not available for this organization." />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ href: "/hoa/properties", label: "Properties" }, { label: "Add property" }]} />
      <PageHeader title="Add a property" description="Creates the property record — you can link owners and residents afterward." />
      <SectionCard title="New property">
        <PropertyForm />
      </SectionCard>
    </main>
  );
}
