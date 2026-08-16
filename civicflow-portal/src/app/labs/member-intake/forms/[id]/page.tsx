import { notFound } from "next/navigation";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { getMemberIntakePageGate } from "@/lib/member-intake/guard";
import { getIntakeForm } from "@/lib/member-intake/forms";
import { getServerEnv } from "@/lib/env";
import { PERMISSIONS } from "@/lib/rbac";
import { MemberIntakeError } from "@/lib/member-intake/errors";
import { MemberIntakeLifecycleActions } from "@/components/labs/member-intake/MemberIntakeLifecycleActions";
import { MemberIntakeQrPanel } from "@/components/labs/member-intake/MemberIntakeQrPanel";
import { MemberIntakeSettingsForm } from "@/components/labs/member-intake/MemberIntakeSettingsForm";
import { MemberIntakeFieldManager } from "@/components/labs/member-intake/MemberIntakeFieldManager";
import { MemberIntakeSourceManager } from "@/components/labs/member-intake/MemberIntakeSourceManager";

export default async function MemberIntakeFormDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId, access, can } = await getMemberIntakePageGate(PERMISSIONS.MEMBER_INTAKE_VIEW);
  const { id } = await params;

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Member Form" description="Not available for this organization." />
      </main>
    );
  }

  let form;
  try {
    form = await getIntakeForm(organizationId, id);
  } catch (error) {
    if (error instanceof MemberIntakeError && error.code === "MEMBER_INTAKE_FORM_NOT_FOUND") notFound();
    throw error;
  }

  const publicUrl = `${getServerEnv().NEXTAUTH_URL.replace(/\/+$/, "")}/f/${form.publicToken}`;
  const canManage = can(PERMISSIONS.MEMBER_INTAKE_MANAGE);
  const canPublish = can(PERMISSIONS.MEMBER_INTAKE_PUBLISH);

  return (
    <main className="space-y-6">
      <PageHeader
        title={form.name}
        description={`Public title: "${form.title}"`}
        actions={[{ href: "/labs/member-intake/forms", label: "Back to Forms" }]}
      />

      <SectionCard title="Status" description="A form must have at least one field before it can be published.">
        <MemberIntakeLifecycleActions formId={form.id} status={form.status} canPublish={canPublish} />
      </SectionCard>

      <SectionCard title="Public link & QR code" description="Anyone with this link or QR code can open the form in a mobile browser — no app install required.">
        <MemberIntakeQrPanel formId={form.id} publicUrl={publicUrl} canRegenerate={canPublish} />
      </SectionCard>

      <SectionCard title="Fields" description="Only fields you add here appear on the public form. Each field can map to a member record column, or be a custom question.">
        <MemberIntakeFieldManager formId={form.id} fields={form.fields} canManage={canManage} />
      </SectionCard>

      <SectionCard title="Matching & verification settings" description="Controls how Unestra decides whether a submission is a new person, an update to an existing member, or needs admin review.">
        <MemberIntakeSettingsForm
          formId={form.id}
          canManage={canManage}
          settings={{
            requireVerificationForExisting: form.requireVerificationForExisting,
            autoCreateNewMember: form.autoCreateNewMember,
            autoApplySafeUpdates: form.autoApplySafeUpdates,
            requireReviewForSensitiveUpdates: form.requireReviewForSensitiveUpdates,
            duplicateHandlingMode: form.duplicateHandlingMode,
          }}
        />
      </SectionCard>

      <SectionCard title="QR campaigns / sources" description="Optional: create a separate QR code per entry point (e.g. 'Sunday Service' vs. 'Fall Open House') to see where submissions come from.">
        <MemberIntakeSourceManager formId={form.id} sources={form.sources} canManage={canManage} />
      </SectionCard>
    </main>
  );
}
