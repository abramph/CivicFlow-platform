import { prisma } from "@/lib/prisma";
import { listOpenActionItems } from "@/lib/meeting-operations";
import { getTransitionDetail } from "./transitions";

/**
 * PTA Vertical 2.0, PR PTA-F — Transition Packet data (§14). Pure data
 * collection, separated from PDF rendering so the §14 confidentiality rule
 * is testable: CONFIDENTIAL GRIEVANCE INFORMATION IS NEVER INCLUDED — at
 * most a count of open, NON-restricted cases, and only when the caller
 * holds pta:concerns:view. No case titles, people, or narrative, ever.
 */

export interface PacketSection {
  title: string;
  lines: string[];
}

function holderName(assignment: { personName: string | null; householdAdult: { name: string } | null } | null): string {
  if (!assignment) return "— vacant —";
  return assignment.householdAdult?.name ?? assignment.personName ?? "— unnamed —";
}

export async function collectTransitionPacketData(
  organizationId: string,
  transitionId: string,
  viewer: { canViewConcerns: boolean }
): Promise<{ title: string; subtitle: string; sections: PacketSection[] }> {
  const transition = await getTransitionDetail(organizationId, transitionId);
  const now = new Date();
  const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const [organization, committees, governanceDocs, decisions, actionItems, upcomingEvents, upcomingMeetings, profile] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    prisma.ptaCommittee.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      include: { chair: { select: { name: true } } },
    }),
    prisma.governanceDocument.findMany({
      where: { organizationId, status: "CURRENT" },
      orderBy: [{ docType: "asc" }, { title: "asc" }],
      select: { title: true, docType: true, version: true, effectiveDate: true },
    }),
    prisma.meetingMotion.findMany({
      where: { organizationId, decisionNumber: { not: null } },
      orderBy: { decidedAt: "desc" },
      take: 25,
      select: { decisionNumber: true, text: true, decidedAt: true },
    }),
    listOpenActionItems(organizationId),
    prisma.event.findMany({
      where: { organizationId, startAt: { gte: now, lte: in90Days } },
      orderBy: { startAt: "asc" },
      take: 20,
      select: { title: true, startAt: true, location: true },
    }),
    prisma.meeting.findMany({
      where: { organizationId, meetingDate: { gte: now, lte: in90Days } },
      orderBy: { meetingDate: "asc" },
      take: 20,
      select: { title: true, meetingDate: true },
    }),
    prisma.ptaProfile.findUnique({ where: { organizationId }, select: { schoolOrPtaName: true, designation: true, contactEmail: true } }),
  ]);

  const sections: PacketSection[] = [];

  sections.push({
    title: "Organization",
    lines: [
      profile?.schoolOrPtaName ?? organization?.name ?? "—",
      ...(profile?.designation ? [`Designation: ${profile.designation}`] : []),
      ...(profile?.contactEmail ? [`Contact: ${profile.contactEmail}`] : []),
      `Transition: ${transition.fromSchoolYear.label} → ${transition.toSchoolYear.label}`,
      `Status: ${transition.status}`,
    ],
  });

  sections.push({
    title: "Board handoff",
    lines: transition.handoffs.map((handoff) => {
      const outgoing = holderName(handoff.outgoingAssignment);
      const incoming = holderName(handoff.incomingAssignment);
      return `${handoff.position.name}: ${outgoing} → ${incoming} (${handoff.status.replaceAll("_", " ").toLowerCase()})`;
    }),
  });

  sections.push({
    title: "Committees",
    lines:
      committees.length === 0
        ? ["No committees on record."]
        : committees.map((committee) => `${committee.name}${committee.chair ? ` — chair: ${committee.chair.name}` : ""} (${committee.status.toLowerCase()})`),
  });

  sections.push({
    title: "Governing documents (current versions)",
    lines:
      governanceDocs.length === 0
        ? ["No current governing documents. Publish bylaws in Bylaws & Policies."]
        : governanceDocs.map(
            (doc) =>
              `${doc.title} — v${doc.version} (${doc.docType.replaceAll("_", " ").toLowerCase()})${doc.effectiveDate ? `, effective ${doc.effectiveDate.toLocaleDateString("en-US")}` : ""}`
          ),
  });

  sections.push({
    title: "Recent board decisions",
    lines:
      decisions.length === 0
        ? ["No numbered decisions on record."]
        : decisions.map(
            (decision) => `#${decision.decisionNumber} — ${decision.text}${decision.decidedAt ? ` (${decision.decidedAt.toLocaleDateString("en-US")})` : ""}`
          ),
  });

  sections.push({
    title: "Outstanding action items",
    lines:
      actionItems.length === 0
        ? ["No open action items."]
        : actionItems
            .slice(0, 30)
            .map(
              (item) =>
                `${item.title}${item.committee ? ` [${item.committee.name}]` : ""}${item.dueDate ? ` — due ${item.dueDate.toLocaleDateString("en-US")}` : ""} (${item.status.replaceAll("_", " ").toLowerCase()})`
            ),
  });

  sections.push({
    title: "Upcoming (next 90 days)",
    lines: [
      ...upcomingMeetings.map((meeting) => `Meeting: ${meeting.title} — ${meeting.meetingDate.toLocaleDateString("en-US")}`),
      ...upcomingEvents.map(
        (event) => `Event: ${event.title}${event.startAt ? ` — ${event.startAt.toLocaleDateString("en-US")}` : ""}${event.location ? ` @ ${event.location}` : ""}`
      ),
      ...(upcomingMeetings.length === 0 && upcomingEvents.length === 0 ? ["Nothing scheduled in the next 90 days."] : []),
    ],
  });

  // §14: never include grievance content. Count of open NON-restricted cases
  // only, and only for concern-permission holders. Restricted cases are not
  // represented at all — not even in the count.
  if (viewer.canViewConcerns) {
    const openConcerns = await prisma.ptaConcern.count({
      where: { organizationId, isRestricted: false, status: { notIn: ["RESOLVED", "DISMISSED", "CLOSED"] } },
    });
    sections.push({
      title: "Concerns",
      lines: [
        `Open cases (non-restricted): ${openConcerns}. Details live in the Concerns register for authorized officers — they are deliberately not included in this packet.`,
      ],
    });
  }

  return {
    title: "Board Transition Packet",
    subtitle: `${profile?.schoolOrPtaName ?? organization?.name ?? ""} — ${transition.fromSchoolYear.label} → ${transition.toSchoolYear.label}`,
    sections,
  };
}
