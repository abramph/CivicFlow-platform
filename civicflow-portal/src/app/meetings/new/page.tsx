import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { MeetingForm } from "@/components/forms/MeetingForm";

export default async function NewMeetingPage() {
  await requirePermission("meetings:write");
  return (
    <main className="space-y-6">
      <PageHeader title="New Meeting" description="Create a meeting, then record bulk attendance." actions={[{ href: "/meetings", label: "Back to Meetings" }, { href: "/dashboard", label: "Back to Dashboard" }]} />
      <SectionCard title="Meeting Details" description="After creation, the attendance worksheet opens automatically.">
        <MeetingForm />
      </SectionCard>
    </main>
  );
}

