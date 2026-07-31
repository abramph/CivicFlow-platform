import { requireOrganization } from "@/lib/auth-guards";
import { getApprovedMeetingMinutes } from "@/lib/meeting-minutes";
import { EmptyState } from "@/components/admin/OperationsUI";

/**
 * Member-facing approved minutes, for ANY member identity (conventional or
 * pure PTA household parent, whose session has no memberId — see
 * /m/my-household for why this can't use getMemberWebSession). Meeting
 * minutes are an org-wide governance document, not member-scoped data, so
 * requireOrganization() (any active session in the org) is the correct
 * gate — the read path itself (getApprovedMeetingMinutes) only ever
 * selects status APPROVED, so a draft or in-review version can never
 * appear here regardless of who's asking.
 */
export default async function MemberMinutesPage() {
  const { organizationId } = await requireOrganization();
  const minutes = await getApprovedMeetingMinutes(organizationId);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Meeting Minutes</h1>
        <p className="mt-1 text-sm text-slate-600">Approved minutes only.</p>
      </div>

      {minutes.length === 0 ? (
        <EmptyState title="No approved minutes yet" description="Approved meeting minutes will appear here once they're published." />
      ) : (
        <div className="space-y-4">
          {minutes.map((m) => (
            <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-6">
              <p className="text-sm font-semibold text-slate-900">{m.title}</p>
              <p className="mt-1 text-xs text-slate-500">
                {m.meeting.title} · {new Date(m.meeting.meetingDate).toLocaleDateString()}
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-800">{m.bodyText}</p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
