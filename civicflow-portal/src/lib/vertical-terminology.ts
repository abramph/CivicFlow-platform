import type { OrganizationVertical } from "@prisma/client";

/**
 * Customer-facing label sets per vertical (Phase 9 of the vertical-product
 * architecture work). Internal terms (OrgMember, tenant, billing identity,
 * feature flag, ledger entry, Prisma model names, ...) must never appear in
 * this map — only the words a customer of that vertical would recognize.
 */
export interface VerticalTerminology {
  /** What the product calls itself in this vertical's context. */
  productLabel: string;
  member: string;
  officer: string;
  duesLabel: string;
  meetingLabel: string;
  documentsLabel: string;
}

const TERMINOLOGY: Record<OrganizationVertical, VerticalTerminology> = {
  COMMUNITY: {
    productLabel: "Community Organization",
    member: "Member",
    officer: "Officer",
    duesLabel: "Dues & Contributions",
    meetingLabel: "Meeting",
    documentsLabel: "Documents",
  },
  PTA: {
    // Product language must read as PTA/PTO even though the internal enum
    // value stays PTA — see OrganizationVertical doc comment in schema.prisma.
    productLabel: "PTA / PTO",
    member: "Parent",
    officer: "PTA/PTO Officer",
    duesLabel: "Membership Dues",
    meetingLabel: "PTA Meeting",
    documentsLabel: "Documents",
  },
  UNION: {
    productLabel: "Union",
    member: "Union Member",
    officer: "Union Officer",
    duesLabel: "Union Dues",
    meetingLabel: "Membership Meeting",
    documentsLabel: "Contract Documents",
  },
  HOA: {
    productLabel: "HOA",
    member: "Resident",
    officer: "Board Member",
    duesLabel: "Assessments",
    meetingLabel: "Board Meeting",
    documentsLabel: "Community Documents",
  },
};

export function getVerticalTerminology(vertical: OrganizationVertical): VerticalTerminology {
  return TERMINOLOGY[vertical];
}

export interface VerticalCardCopy {
  vertical: OrganizationVertical;
  title: string;
  description: string;
  highlights: string[];
}

/** The four signup/onboarding selection cards (Phase 6). Order is the
 * required display order. */
export const VERTICAL_SELECTION_CARDS: VerticalCardCopy[] = [
  {
    vertical: "COMMUNITY",
    title: "Community Organization",
    description:
      "For nonprofits, civic groups, cultural associations, clubs, alumni groups, and community-based organizations.",
    highlights: ["Members", "Communications", "Events", "Committees", "Dues and contributions", "Meetings"],
  },
  {
    vertical: "PTA",
    title: "PTA / PTO",
    description:
      "For parent-teacher associations, parent-teacher organizations, school family groups, and education-based volunteer organizations.",
    highlights: ["Households", "Parents and students", "Grades and classrooms", "Membership dues", "Events", "Volunteer coordination"],
  },
  {
    vertical: "UNION",
    title: "Union",
    description: "For labor unions, locals, chapters, bargaining units, and worker membership organizations.",
    highlights: ["Members and officers", "Dues", "Meetings", "Communications", "Contract documents", "Events"],
  },
  {
    vertical: "HOA",
    title: "HOA",
    description: "For homeowners associations, condominium communities, neighborhood associations, and residential boards.",
    highlights: ["Residents or members", "Board meetings", "Announcements", "Events", "Documents", "Payments or assessments where supported"],
  },
];
