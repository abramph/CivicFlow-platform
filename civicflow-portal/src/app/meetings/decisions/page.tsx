import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { listDecisions, listOpenActionItems } from "@/lib/meeting-operations";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDate } from "@/lib/formatting";

/**
 * PTA Vertical 2.0, PR PTA-C — the Decision Register: every passed motion,
 * permanently numbered, searchable; plus the open action items those
 * decisions created. "What did the previous board decide?" answered on one
 * page.
 */
export default async function DecisionRegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await requirePermission("meetings:read");
  const params = await searchParams;
  const search = (Array.isArray(params.search) ? params.search[0] : params.search) ?? "";

  const [decisions, openItems] = await Promise.all([
    listDecisions(organizationId, { search: search || undefined }),
    listOpenActionItems(organizationId),
  ]);
  const now = new Date();
  const overdue = openItems.filter((item) => item.dueDate && item.dueDate < now);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Decision Register"
        description="Every motion your organization has passed, permanently numbered — plus the follow-up work still open."
        actions={[{ href: "/meetings", label: "Back to Meetings" }]}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Decisions on record" value={decisions.length} />
        <StatCard label="Open action items" value={openItems.length} />
        <StatCard label="Overdue" value={overdue.length} />
      </div>

      <SectionCard title="Search">
        <form action="/meetings/decisions" method="get" className="flex flex-wrap gap-2">
          <input
            name="search"
            defaultValue={search}
            placeholder="Search decision text or number (e.g. 2026-014)"
            className="w-80 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          />
          <button type="submit" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
            Search
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Decisions" description={`${decisions.length} passed motion(s)${search ? ` matching "${search}"` : ""}.`}>
        {decisions.length === 0 ? (
          <p className="text-sm text-slate-600">No passed motions yet — decisions appear here automatically when a motion is recorded as passed on a meeting page.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {decisions.map((decision) => (
              <li key={decision.id} className="py-3 text-sm">
                <p className="font-semibold text-slate-900">Decision #{decision.decisionNumber}</p>
                <p className="text-slate-800">{decision.text}</p>
                <p className="mt-1 text-xs text-slate-600">
                  <Link href={`/meetings/${decision.meeting.id}`} className="text-emerald-700 hover:underline">
                    {decision.meeting.title}
                  </Link>{" "}
                  · {formatDate(decision.meeting.meetingDate)}
                  {decision.votesYes !== null || decision.votesNo !== null
                    ? ` · Vote ${decision.votesYes ?? 0}–${decision.votesNo ?? 0}${decision.votesAbstain ? `–${decision.votesAbstain}` : ""}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Open action items" description="Work created by meetings that isn't finished yet, soonest due first.">
        {openItems.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing outstanding.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {openItems.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="text-slate-900">
                  {item.title}
                  {item.ownerName ? <span className="text-slate-600"> — {item.ownerName}</span> : null}
                  {item.committee ? <span className="text-slate-500"> · {item.committee.name}</span> : null}
                </span>
                <span className={item.dueDate && item.dueDate < now ? "text-xs font-semibold text-red-700" : "text-xs text-slate-600"}>
                  {item.dueDate ? `Due ${formatDate(item.dueDate)}` : "No due date"}
                  {item.meeting ? (
                    <>
                      {" · "}
                      <Link href={`/meetings/${item.meeting.id}`} className="text-emerald-700 hover:underline">
                        {item.meeting.title}
                      </Link>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </main>
  );
}
