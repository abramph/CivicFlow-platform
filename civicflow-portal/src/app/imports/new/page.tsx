import { redirect } from "next/navigation";
import type { ImportKind } from "@prisma/client";
import { requirePermission } from "@/lib/auth-guards";
import { requirePtaVertical } from "@/lib/labs/pta/guard";
import { requireHoaCapability } from "@/lib/hoa/guard";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { ImportUploadForm } from "@/components/import/ImportUploadForm";

const KIND_COPY: Record<ImportKind, { title: string; description: string }> = {
  COMMUNITY_MEMBERS: {
    title: "Import Members (Beta)",
    description: "Upload a CSV or Excel file of members. Large files and plan-limit pauses are handled automatically — you can leave this page and come back to resume.",
  },
  PTA_HOUSEHOLDS: {
    title: "Import PTA Households (Beta)",
    description: "Upload a CSV or Excel file of households. Resumable and duplicate-aware, same as the Members import.",
  },
  HOA_PROPERTIES: {
    title: "Import HOA Properties (Beta)",
    description: "Upload a CSV or Excel file of properties. Resumable and duplicate-aware, same as the Members import.",
  },
};

export default async function NewImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind: kindParam } = await searchParams;
  const kind: ImportKind = kindParam === "PTA_HOUSEHOLDS" || kindParam === "HOA_PROPERTIES" ? kindParam : "COMMUNITY_MEMBERS";

  const { organizationId, can } = await requirePermission("imports:create");

  if (kind === "PTA_HOUSEHOLDS") {
    try {
      await requirePtaVertical(organizationId);
    } catch {
      redirect("/dashboard?error=forbidden");
    }
    if (!can("pta:households:manage")) redirect("/dashboard?error=forbidden");
  } else if (kind === "HOA_PROPERTIES") {
    try {
      await requireHoaCapability(organizationId);
    } catch {
      redirect("/dashboard?error=forbidden");
    }
    if (!can("hoa:properties:write") || !can("hoa:residents:write")) redirect("/dashboard?error=forbidden");
  } else if (!can("members:write")) {
    redirect("/dashboard?error=forbidden");
  }

  const copy = KIND_COPY[kind];

  return (
    <main className="space-y-6">
      <PageHeader title={copy.title} description={copy.description} actions={[{ href: "/imports", label: "Import History" }]} />

      <SectionCard title="Upload file" description="First row must be column headers.">
        <ImportUploadForm kind={kind} />
      </SectionCard>
    </main>
  );
}
