import { redirect } from "next/navigation";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { getMemberIntakePageGate } from "@/lib/member-intake/guard";
import { getOrganizationVertical, getIntakeFormPreset } from "@/lib/member-intake/presets";
import { MemberIntakeFormCreateForm } from "@/components/labs/member-intake/MemberIntakeFormCreateForm";
import { MemberIntakePresetButton } from "@/components/labs/member-intake/MemberIntakePresetButton";
import { PERMISSIONS } from "@/lib/rbac";

export default async function NewMemberIntakeFormPage() {
  const { organizationId, access, can } = await getMemberIntakePageGate(PERMISSIONS.MEMBER_INTAKE_MANAGE);

  if (!access.available || !can(PERMISSIONS.MEMBER_INTAKE_MANAGE)) {
    redirect("/labs/member-intake/forms");
  }

  const vertical = await getOrganizationVertical(organizationId);
  const preset = getIntakeFormPreset(vertical);

  return (
    <main className="space-y-6">
      <PageHeader
        title="New Member Form"
        description="Start with a name and purpose — you'll add fields and publish the form on the next screen."
        actions={[{ href: "/labs/member-intake/forms", label: "Back to Forms" }]}
      />
      <SectionCard
        title="Quick start"
        description={`"${preset.name}" comes pre-filled with the fields most ${vertical === "PTA" ? "PTA/PTO" : vertical.charAt(0) + vertical.slice(1).toLowerCase()} organizations collect. You can add, remove, or edit any field afterward.`}
      >
        <MemberIntakePresetButton vertical={vertical} presetName={preset.name} fieldCount={preset.fields.length} />
      </SectionCard>
      <SectionCard title="Or start from scratch" description="Pick a name and purpose — you'll add fields on the next screen.">
        <MemberIntakeFormCreateForm />
      </SectionCard>
    </main>
  );
}
