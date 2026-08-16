import { redirect } from "next/navigation";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { getMemberIntakePageGate } from "@/lib/member-intake/guard";
import { MemberIntakeFormCreateForm } from "@/components/labs/member-intake/MemberIntakeFormCreateForm";
import { PERMISSIONS } from "@/lib/rbac";

export default async function NewMemberIntakeFormPage() {
  const { access, can } = await getMemberIntakePageGate(PERMISSIONS.MEMBER_INTAKE_MANAGE);

  if (!access.available || !can(PERMISSIONS.MEMBER_INTAKE_MANAGE)) {
    redirect("/labs/member-intake/forms");
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title="New Member Form"
        description="Start with a name and purpose — you'll add fields and publish the form on the next screen."
        actions={[{ href: "/labs/member-intake/forms", label: "Back to Forms" }]}
      />
      <SectionCard title="Form basics" description="You can change any of this later.">
        <MemberIntakeFormCreateForm />
      </SectionCard>
    </main>
  );
}
