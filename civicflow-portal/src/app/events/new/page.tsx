import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { EventForm } from "@/components/forms/EventForm";

export default async function NewEventPage() {
  await requirePermission("events:write");

  return (
    <main className="space-y-6">
      <PageHeader
        title="New Event"
        description="Create an event with a schedule, location, and status that can receive attributed contributions."
        actions={[
          { href: "/events", label: "Back to Events" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <SectionCard title="Event Setup" description="Event creation is protected by events:write and scoped by the authenticated organization.">
        <EventForm mode="create" />
      </SectionCard>
    </main>
  );
}
