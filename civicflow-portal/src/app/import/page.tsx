import { requireOrganization } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { getVerticalCapabilities } from "@/lib/vertical-capabilities";
import { ImportPageClient } from "@/components/import/ImportPageClient";

export default async function ImportPage() {
  const { organizationId } = await requireOrganization();
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { primaryVertical: true },
  });
  const capabilities = getVerticalCapabilities(organization?.primaryVertical ?? "COMMUNITY");

  return <ImportPageClient capabilities={capabilities} />;
}
