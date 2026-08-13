import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { listContacts } from "@/lib/contacts";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { PtaContactDirectory } from "@/components/labs/pta/PtaContactDirectory";

/**
 * PTA Vertical 2.0, PR PTA-I — institutional contacts & vendor history
 * (brief §23–§24). The directory belongs to the PTA, not an outgoing
 * officer's phone.
 */
export default async function PtaContactsPage() {
  const { organizationId, access, can } = await getPtaPageGate("contacts:read");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Contacts & Vendors" description="Not available for this organization." />
      </main>
    );
  }

  const contacts = await listContacts(organizationId, { includeInactive: true });

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Contacts & Vendors"
        description="Your PTA's institutional memory: school and district contacts, council and state PTA, insurance, accountants, venues, and every vendor you've used — with spend history pulled straight from the ledger."
      />
      <SectionCard title="Directory" description="Vendor spend and event history are computed from expenditures automatically — nothing to keep in sync.">
        <PtaContactDirectory
          contacts={contacts.map((contact) => ({
            id: contact.id,
            name: contact.name,
            contactPerson: contact.contactPerson,
            role: contact.role,
            phone: contact.phone,
            email: contact.email,
            website: contact.website,
            category: contact.category,
            notes: contact.notes,
            isVendor: contact.isVendor,
            rating: contact.rating,
            isActive: contact.isActive,
            lastReviewedAt: contact.lastReviewedAt?.toISOString() ?? null,
          }))}
          canWrite={can("contacts:write")}
        />
      </SectionCard>
    </main>
  );
}
