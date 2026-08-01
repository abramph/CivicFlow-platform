import type { OrganizationVertical } from "@prisma/client";

/**
 * Customer-facing label sets per vertical (Phase 6/9 of the vertical-product
 * architecture work). Internal terms (OrgMember, tenant, billing identity,
 * feature flag, ledger entry, Prisma model names, ...) must never appear in
 * this map — only the words a customer of that vertical would recognize.
 */
export interface VerticalTerminology {
  /** What the product calls itself in this vertical's context. */
  productLabel: string;
  member: string;
  memberPlural: string;
  officer: string;
  duesLabel: string;
  meetingLabel: string;
  documentsLabel: string;
  /** Dashboard page heading and its one-line welcome copy. */
  dashboardTitle: string;
  dashboardWelcome: string;
}

const TERMINOLOGY: Record<OrganizationVertical, VerticalTerminology> = {
  COMMUNITY: {
    productLabel: "Community Organization",
    member: "Member",
    memberPlural: "Members",
    officer: "Officer",
    duesLabel: "Dues & Contributions",
    meetingLabel: "Meeting",
    documentsLabel: "Documents",
    dashboardTitle: "Dashboard",
    dashboardWelcome: "Welcome to Unestra. Overview metrics below.",
  },
  PTA: {
    // Product language must read as PTA/PTO even though the internal enum
    // value stays PTA — see OrganizationVertical doc comment in schema.prisma.
    productLabel: "PTA / PTO",
    member: "Parent",
    memberPlural: "Households",
    officer: "PTA/PTO Officer",
    duesLabel: "Membership Dues",
    meetingLabel: "PTA Meeting",
    documentsLabel: "Documents",
    dashboardTitle: "PTA Dashboard",
    dashboardWelcome: "Welcome to Unestra for PTA. Household, dues, and volunteer activity below.",
  },
  UNION: {
    productLabel: "Union",
    member: "Union Member",
    memberPlural: "Union Members",
    officer: "Union Officer",
    duesLabel: "Union Dues",
    meetingLabel: "Membership Meeting",
    documentsLabel: "Contract Documents",
    dashboardTitle: "Union Dashboard",
    dashboardWelcome: "Welcome to Unestra for Unions. Membership and dues activity below.",
  },
  HOA: {
    productLabel: "HOA",
    member: "Resident",
    memberPlural: "Residents",
    officer: "Board Member",
    duesLabel: "Assessments",
    meetingLabel: "Board Meeting",
    documentsLabel: "Community Documents",
    dashboardTitle: "HOA Dashboard",
    dashboardWelcome: "Welcome to Unestra for HOAs. Resident and assessment activity below.",
  },
};

export function getVerticalTerminology(vertical: OrganizationVertical): VerticalTerminology {
  return TERMINOLOGY[vertical];
}

export interface VerticalCardCopy {
  vertical: OrganizationVertical;
  title: string;
  /** Lucide icon name (e.g. "Building2") — kept as a string so this stays a
   * pure data module with no React/component dependency; the consuming
   * client component maps it to an actual icon. */
  icon: string;
  description: string;
  /** Concrete examples of who picks this vertical. */
  examples: string[];
  /** One-line preview of this vertical's vocabulary, so a founder can see
   * what their members/dues will be called before committing to a vertical. */
  terminologyPreview: string;
  highlights: string[];
}

/** The four signup/onboarding selection cards (Phase 6). Order is the
 * required display order. */
export const VERTICAL_SELECTION_CARDS: VerticalCardCopy[] = [
  {
    vertical: "COMMUNITY",
    title: "Community Organization",
    icon: "Building2",
    description: "Civic associations, nonprofits, churches, clubs, and cultural organizations.",
    examples: ["Civic associations", "Nonprofits", "Churches", "Clubs", "Cultural organizations", "Alumni groups"],
    terminologyPreview: "Members pay Dues & Contributions.",
    highlights: ["Members", "Communications", "Events", "Committees", "Dues and contributions", "Meetings"],
  },
  {
    vertical: "PTA",
    title: "PTA / PTO",
    icon: "GraduationCap",
    description: "Parent organizations supporting schools, families, volunteers, and fundraising.",
    examples: ["Parent-teacher associations", "Parent-teacher organizations", "School family groups", "Booster clubs"],
    terminologyPreview: "Parents belong to Households; pay Membership Dues.",
    highlights: ["Households", "Parents and students", "Grades and classrooms", "Membership dues", "Events", "Volunteer coordination"],
  },
  {
    vertical: "UNION",
    title: "Union",
    icon: "Handshake",
    description: "Labor organizations managing membership, dues, payroll checkoff, and communication.",
    examples: ["Labor unions", "Locals", "Chapters", "Bargaining units", "Worker membership organizations"],
    terminologyPreview: "Union Members pay Union Dues (including payroll checkoff).",
    highlights: ["Members and officers", "Dues", "Payroll checkoff", "Meetings", "Communications", "Contract documents"],
  },
  {
    vertical: "HOA",
    title: "HOA",
    icon: "Home",
    description: "Homeowner associations managing residents, assessments, board governance, and properties.",
    examples: ["Homeowners associations", "Condominium communities", "Neighborhood associations", "Residential boards"],
    terminologyPreview: "Residents pay Assessments; a Board governs.",
    highlights: ["Residents", "Board meetings", "Announcements", "Events", "Documents", "Assessments"],
  },
];

/** A small, shared vocabulary of empty-state situations every vertical hits
 * (Phase 8) — deliberately not a generic "No records found" for any of them. */
export type EmptyStateKey = "members" | "events" | "meetings" | "documents" | "communications";

const EMPTY_STATES: Record<OrganizationVertical, Record<EmptyStateKey, string>> = {
  COMMUNITY: {
    members: "No members have been added yet.",
    events: "No events have been created yet.",
    meetings: "No meetings have been scheduled yet.",
    documents: "No documents have been uploaded yet.",
    communications: "No announcements have been sent yet.",
  },
  PTA: {
    members: "No households have been added yet.",
    events: "No events have been created yet.",
    meetings: "No PTA meetings have been scheduled yet.",
    documents: "No documents have been uploaded yet.",
    communications: "No announcements have been sent yet.",
  },
  UNION: {
    members: "No union members have been added yet.",
    events: "No events have been created yet.",
    meetings: "No membership meetings have been scheduled yet.",
    documents: "No contract documents have been uploaded yet.",
    communications: "No announcements have been sent yet.",
  },
  HOA: {
    members: "No residents have been added yet.",
    events: "No community events have been created yet.",
    meetings: "No board meetings have been scheduled yet.",
    documents: "No community documents have been uploaded yet.",
    communications: "No announcements have been sent yet.",
  },
};

export function getEmptyStateCopy(vertical: OrganizationVertical, key: EmptyStateKey): string {
  return EMPTY_STATES[vertical][key];
}

export interface QuickAction {
  href: string;
  label: string;
}

/** Phase 7 — only actions with a real, working destination. */
const QUICK_ACTIONS: Record<OrganizationVertical, QuickAction[]> = {
  COMMUNITY: [
    { href: "/members/new", label: "Invite Member" },
    { href: "/events/new", label: "Create Event" },
    { href: "/communications", label: "Send Announcement" },
  ],
  PTA: [
    { href: "/labs/pta/households/new", label: "Invite Parent" },
    { href: "/labs/pta/volunteers/manage", label: "Create Volunteer Opportunity" },
    { href: "/labs/pta/events", label: "Create Event" },
    { href: "/labs/pta/dues", label: "Create Membership Dues" },
  ],
  UNION: [
    { href: "/members/new", label: "Invite Member" },
    { href: "/settings/organization", label: "Upload Contract" },
    { href: "/meetings/new", label: "Schedule Meeting" },
    { href: "/communications", label: "Create Announcement" },
  ],
  HOA: [
    { href: "/members/new", label: "Invite Resident" },
    { href: "/meetings/new", label: "Schedule Board Meeting" },
    { href: "/communications", label: "Post Announcement" },
    { href: "/settings/organization", label: "Upload Governing Document" },
  ],
};

export function getQuickActions(vertical: OrganizationVertical): QuickAction[] {
  return QUICK_ACTIONS[vertical];
}

export interface HelpTopic {
  title: string;
  description: string;
  href: string;
}

/** Phase 9 — contextual help, scoped so a PTA user never sees Community
 * fundraising instructions, a Union user never sees PTA instructions, etc. */
const HELP_TOPICS: Record<OrganizationVertical, HelpTopic[]> = {
  COMMUNITY: [
    { title: "Add and manage members", description: "Bring your roster into Unestra and keep it current.", href: "/members" },
    { title: "Create events", description: "Schedule and track attendance for organization events.", href: "/events" },
    { title: "Collect dues or contributions", description: "Set up dues plans and record contributions.", href: "/dues" },
    { title: "Send announcements", description: "Reach your members by email.", href: "/communications" },
  ],
  PTA: [
    { title: "Add households and students", description: "Build your household directory with students and adults.", href: "/labs/pta/households" },
    { title: "Configure classrooms", description: "Set up grades, classrooms, and teachers for the school year.", href: "/labs/pta/academic" },
    { title: "Track membership dues", description: "Create and collect this year's membership dues.", href: "/labs/pta/dues" },
    { title: "Coordinate volunteers", description: "Post volunteer opportunities and track sign-ups.", href: "/labs/pta/volunteers" },
    { title: "Invite parents", description: "Link a household adult to a platform account.", href: "/labs/pta/households" },
  ],
  UNION: [
    { title: "Add members and officers", description: "Bring your roster into Unestra.", href: "/members" },
    { title: "Track dues", description: "Set up and collect union dues.", href: "/dues" },
    { title: "Manage meetings", description: "Schedule membership meetings and record minutes.", href: "/meetings" },
    { title: "Share contract documents", description: "Attach contract and governance documents to your organization profile.", href: "/settings/organization" },
    { title: "Communicate with members", description: "Send announcements by email.", href: "/communications" },
  ],
  HOA: [
    { title: "Add residents or members", description: "Bring your resident roster into Unestra.", href: "/members" },
    { title: "Configure board access", description: "Assign board roles under Users & Roles.", href: "/settings/users" },
    { title: "Schedule meetings", description: "Schedule board meetings and record minutes.", href: "/meetings" },
    { title: "Share community documents", description: "Attach governance documents to your organization profile.", href: "/settings/organization" },
    { title: "Send community announcements", description: "Reach residents by email.", href: "/communications" },
  ],
};

export function getHelpTopics(vertical: OrganizationVertical): HelpTopic[] {
  return HELP_TOPICS[vertical];
}
