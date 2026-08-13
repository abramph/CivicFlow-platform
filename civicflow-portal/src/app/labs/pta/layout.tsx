import type { ReactNode } from "react";
import { requireOrganization } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PtaTabNav, type PtaTab } from "@/components/labs/pta/PtaTabNav";

/**
 * Shared in-vertical navigation for every /labs/pta/* page — replaces the
 * hand-written 2-3 footer links each page used to carry on its own (see
 * docs/pta-labs-mvp.md and the product readiness review's "no shared PTA
 * layout" finding). Officer tabs are gated per-tab by the same permission
 * their target page/route already requires; parent tabs (My Household, My
 * Membership, Volunteer Opportunities) show whenever the caller is a linked
 * household adult, independent of any staff permission — mirroring
 * guard.ts's requirePtaHouseholdSelfAccess() convention. A user who is both
 * (an officer who is also a parent, as in the fictional seed data) sees both
 * sets at once.
 */
export default async function PtaLayout({ children }: { children: ReactNode }) {
  const { organizationId, session, can } = await requireOrganization();
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { primaryVertical: true, status: true },
  });

  if (!organization || organization.primaryVertical !== "PTA" || organization.status !== "active") {
    // Individual pages already render their own "not available" messaging
    // via their own PTA vertical check — don't duplicate that here, just
    // skip the tab bar entirely.
    return <>{children}</>;
  }

  const profile = await prisma.ptaProfile.findUnique({
    where: { organizationId },
    select: { concernsEnabled: true, concernsLabel: true },
  });

  const officerTabs: PtaTab[] = [
    { href: "/labs/pta/dashboard", label: "Dashboard", visible: can("pta:analytics:read") },
    { href: "/labs/pta/board", label: "Board", visible: can("pta:board:view") },
    { href: "/labs/pta/transition", label: "Transition", visible: can("pta:board:view") },
    { href: "/labs/pta/households", label: "Households", visible: can("pta:directory:read") },
    { href: "/labs/pta/academic", label: "Academic", visible: can("pta:directory:read") },
    { href: "/labs/pta/committees", label: "Committees", visible: can("pta:directory:read") },
    { href: "/labs/pta/volunteers/manage", label: "Manage Volunteers", visible: can("pta:volunteers:manage") },
    { href: "/labs/pta/volunteers/approvals", label: "Hour Approvals", visible: can("pta:volunteer-hours:approve") },
    { href: "/labs/pta/dues", label: "Dues & Payments", visible: can("pta:dues:manage") },
    { href: "/labs/pta/events", label: "Events", visible: can("pta:events:manage") },
    { href: "/labs/pta/communications", label: "Communications", visible: can("pta:announcements:publish") },
    { href: "/labs/pta/documents", label: "Documents", visible: can("documents:read") },
    { href: "/labs/pta/governance", label: "Bylaws & Policies", visible: can("governance:read") },
    {
      href: "/labs/pta/concerns",
      label: profile?.concernsLabel?.trim() || "Concerns",
      // PTA-E: permission AND feature switch — the tab disappears entirely
      // when the module is turned off in PTA Setup.
      visible: can("pta:concerns:view") && profile?.concernsEnabled !== false,
    },
    { href: "/labs/pta/onboarding", label: "Onboarding", visible: can("pta:households:manage") },
    { href: "/labs/pta/settings", label: "Settings", visible: can("pta:households:manage") },
  ];

  const adult = await prisma.ptaHouseholdAdult.findFirst({
    where: { organizationId, userId: session.userId },
    select: { id: true },
  });

  const parentTabs: PtaTab[] = [
    { href: "/labs/pta/my-household", label: "My Household", visible: Boolean(adult) },
    { href: "/labs/pta/membership", label: "My Membership", visible: Boolean(adult) },
    { href: "/labs/pta/volunteers", label: "Volunteer Opportunities", visible: Boolean(adult) },
  ];

  return (
    <div className="space-y-6">
      <PtaTabNav officerTabs={officerTabs} parentTabs={parentTabs} />
      {children}
    </div>
  );
}
