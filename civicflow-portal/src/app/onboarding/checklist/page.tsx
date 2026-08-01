import Link from "next/link";
import { requireOrganization } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { getVerticalTerminology } from "@/lib/vertical-terminology";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import type { OrganizationVertical } from "@prisma/client";

interface Step {
  title: string;
  description: string;
  href: string;
  linkLabel: string;
  done: boolean;
}

/**
 * The one-time guided-onboarding checklist for a brand-new Community, Union,
 * or HOA organization (PTA keeps its own richer checklist at
 * /labs/pta/onboarding — see getOnboardingRoute). Every step links to a
 * real, already-working page. Community's and Union's steps are guided
 * tours through existing generic capabilities (dues, payment imports,
 * users & roles, communications) with zero new schema; HOA's steps (PR #43)
 * additionally cover the real Property/PropertyResident registry — see
 * docs/hoa-domain-model.md.
 */
export default async function OnboardingChecklistPage() {
  const { organizationId, session } = await requireOrganization();
  const vertical: OrganizationVertical = session.primaryVertical ?? "COMMUNITY";
  const terminology = getVerticalTerminology(vertical);

  const [
    organization,
    memberCount,
    eventCount,
    campaignCount,
    duesCategoryCount,
    checkoffImportCount,
    staffCount,
    propertyCount,
    propertyResidentCount,
    meetingCount,
    governingDocumentCount,
  ] =
    await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { email: true, phone: true, addressLine1: true, city: true, state: true, zipCode: true },
      }),
      prisma.orgMember.count({ where: { organizationId } }),
      prisma.event.count({ where: { organizationId } }),
      prisma.communicationCampaign.count({ where: { organizationId } }),
      prisma.category.count({ where: { organizationId, type: "DUES" } }),
      prisma.paymentImportBatch.count({ where: { organizationId, sourceType: "PAYROLL_CHECKOFF" } }),
      prisma.organizationMembership.count({ where: { organizationId, role: { not: "ORG_OWNER" } } }),
      // PR #43 -- HOA Property/Resident foundation.
      prisma.property.count({ where: { organizationId } }),
      prisma.propertyResident.count({ where: { organizationId } }),
      prisma.meeting.count({ where: { organizationId } }),
      prisma.attachment.count({ where: { organizationId, entityType: "ORGANIZATION" } }),
    ]);

  const profileComplete = Boolean(
    organization?.email && organization?.phone && organization?.addressLine1 && organization?.city && organization?.state && organization?.zipCode
  );

  const stepsByVertical: Record<"COMMUNITY" | "UNION" | "HOA", Step[]> = {
    COMMUNITY: [
      { title: "Complete your organization profile", description: "Add contact details and address.", href: "/settings/organization", linkLabel: "Go to Profile", done: profileComplete },
      { title: "Invite members", description: "Add your first members to the roster.", href: "/members/new", linkLabel: "Add a Member", done: memberCount > 0 },
      { title: "Create your first event", description: "Schedule an event members can attend.", href: "/events/new", linkLabel: "Create Event", done: eventCount > 0 },
      { title: "Send your first announcement", description: "Reach your members by email.", href: "/communications/campaigns", linkLabel: "Go to Communications", done: campaignCount > 0 },
    ],
    UNION: [
      { title: "Set up dues", description: "Create a dues category so you can start charging union dues.", href: "/settings/dues", linkLabel: "Go to Dues Setup", done: duesCategoryCount > 0 },
      {
        title: "Payroll checkoff overview",
        description: "Employer payroll-deduction dues, remitted in bulk, are reconciled through the bulk payment-import tool — the same tool as any other bulk import source.",
        href: "/payments/imports/new",
        linkLabel: "Go to Payment Imports",
        done: checkoffImportCount > 0,
      },
      { title: "Import your members", description: "Bring in your existing roster via bulk import.", href: "/import", linkLabel: "Go to Import", done: memberCount > 0 },
      { title: "Add officers", description: "Assign officer/staff access under Users & Roles.", href: "/settings/users", linkLabel: "Go to Users & Roles", done: staffCount > 0 },
      { title: "Set up communications", description: "Send your first announcement to members.", href: "/communications/campaigns", linkLabel: "Go to Communications", done: campaignCount > 0 },
    ],
    // PR #43: Property/Resident foundation -- steps reflect the real
    // Property/PropertyResident registry (docs/hoa-domain-model.md), not
    // the earlier "properties tracked as members" placeholder.
    HOA: [
      { title: "Complete your association profile", description: "Add contact details and address.", href: "/settings/organization", linkLabel: "Go to Profile", done: profileComplete },
      { title: "Add your first property", description: "Record a lot, unit, townhome, or common property.", href: "/hoa/properties/new", linkLabel: "Add a Property", done: propertyCount > 0 },
      { title: "Add or import residents", description: "Bring in your owner/resident roster.", href: "/members/new", linkLabel: "Add a Resident", done: memberCount > 0 },
      { title: "Link an owner or resident to a property", description: "Connect a member to the property they own or live in.", href: "/hoa/properties", linkLabel: "Go to Properties", done: propertyResidentCount > 0 },
      { title: "Invite board members", description: "Assign board member access under Users & Roles.", href: "/settings/users", linkLabel: "Go to Users & Roles", done: staffCount > 0 },
      { title: "Schedule your first board meeting", description: "Set a date, agenda, and location.", href: "/meetings/new", linkLabel: "Schedule Meeting", done: meetingCount > 0 },
      { title: "Send your first announcement", description: "Reach residents by email.", href: "/communications/campaigns", linkLabel: "Go to Communications", done: campaignCount > 0 },
      { title: "Upload governing documents", description: "Add your CC&Rs, bylaws, or budget for residents to reference.", href: "/settings/organization", linkLabel: "Go to Documents", done: governingDocumentCount > 0 },
    ],
  };

  const steps = stepsByVertical[vertical === "PTA" ? "COMMUNITY" : vertical];
  const completedCount = steps.filter((s) => s.done).length;

  return (
    <main className="space-y-6">
      <PageHeader
        title={`${terminology.productLabel} Setup Checklist`}
        description={`${completedCount} of ${steps.length} steps complete. This is instructional — every link goes to a real, working page.`}
        actions={[{ href: "/dashboard", label: "Skip to Dashboard" }]}
      />

      <SectionCard title="Steps">
        <ol className="space-y-3">
          {steps.map((step, i) => (
            <li key={step.title} className="flex items-start gap-4 rounded-lg border border-slate-200 p-4">
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  step.done ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"
                }`}
                aria-hidden="true"
              >
                {step.done ? "✓" : i + 1}
              </span>
              <div className="flex-1">
                <p className="font-semibold text-slate-900">{step.title}</p>
                <p className="text-sm text-slate-600">{step.description}</p>
              </div>
              <Link href={step.href} className="shrink-0 self-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50">
                {step.linkLabel}
              </Link>
            </li>
          ))}
        </ol>
      </SectionCard>
    </main>
  );
}
