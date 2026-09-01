import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { ExpenditureForm } from "@/components/forms/ExpenditureForm";
import { getExpenditureFormOptions } from "@/lib/expenditure-options";

const BASE_PATH = "/labs/pta/finance/expenditures";

export default async function TreasurerNewExpenditurePage() {
  const { organizationId, access } = await getPtaPageGate("expenditures:write");
  if (!access.available) return null;
  const options = await getExpenditureFormOptions(organizationId, "PTA");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add Expenditure"
        description="Record outgoing spending with category, payment method, committee, and supporting reference details."
        actions={[{ href: BASE_PATH, label: "Back to Expenditures" }]}
      />
      <SectionCard title="Expenditure Entry" description="Saved through the protected expenditure API — the same one the generic /expenditures route uses.">
        <ExpenditureForm mode="create" basePath={BASE_PATH} {...options} />
      </SectionCard>
    </div>
  );
}
