import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { NewMemberImportForm } from "@/components/import/NewMemberImportForm";

export default async function NewImportPage() {
  const { can } = await requirePermission("imports:create");
  if (!can("members:write")) {
    redirect("/dashboard?error=forbidden");
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title="Import Members (Beta)"
        description="Upload a CSV or Excel file of members. Large files and plan-limit pauses are handled automatically — you can leave this page and come back to resume."
        actions={[{ href: "/imports", label: "Import History" }]}
      />

      <SectionCard title="Upload file" description="First row must be column headers.">
        <NewMemberImportForm />
      </SectionCard>
    </main>
  );
}
