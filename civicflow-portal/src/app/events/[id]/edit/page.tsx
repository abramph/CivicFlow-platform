import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { EventForm } from "@/components/forms/EventForm";
import { formatDateTimeLocalInputValue } from "@/lib/formatting";
import { prisma } from "@/lib/prisma";

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organizationId } = await requirePermission("events:write");
  const { id } = await params;

  const event = await prisma.event.findFirst({
    where: { id, organizationId },
  });

  if (!event) {
    return (
      <main className="space-y-6">
        <PageHeader
          title="Event not found"
          description="The event you are trying to edit is unavailable in your organization."
          actions={[
            { href: "/events", label: "Back to Events" },
            { href: "/dashboard", label: "Back to Dashboard" },
          ]}
        />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title="Edit Event"
        description="Update schedule, location, or status through the protected events API."
        actions={[
          { href: `/events/${event.id}`, label: "Back to Event" },
          { href: "/events", label: "Back to Events" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <SectionCard title="Event Form" description="Edit the title, logistics, description, or revenue status for this event.">
        <EventForm
          mode="edit"
          event={{
            id: event.id,
            title: event.title,
            description: event.description,
            location: event.location,
            startAt: formatDateTimeLocalInputValue(event.startAt),
            endAt: formatDateTimeLocalInputValue(event.endAt),
            status: event.status,
            notes: event.notes,
          }}
        />
      </SectionCard>
    </main>
  );
}
