import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { ExpenditureForm } from "@/components/forms/ExpenditureForm";
import { getExpenditureFormOptions } from "@/lib/expenditure-options";

export default async function NewExpenditurePage() {
  const { organizationId, session } = await requirePermission("expenditures:write");
  const options = await getExpenditureFormOptions(organizationId, session.primaryVertical ?? "COMMUNITY");

  return (
    <main className="space-y-6">
      <PageHeader
        title="Add Expenditure"
        description="Record outgoing spending with category, payment method, campaign/event attribution, and supporting reference details."
        actions={[
          { href: "/expenditures", label: "Back to Expenditures" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />
      <SectionCard title="Expenditure Entry" description="Saved through the protected expenditure API.">
        <ExpenditureForm mode="create" basePath="/expenditures" {...options} />
      </SectionCard>
    </main>
  );
}
