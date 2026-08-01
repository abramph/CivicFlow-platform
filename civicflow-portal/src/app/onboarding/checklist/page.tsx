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
 * real, already-working page; nothing here is a new feature or a new data
 * model — Union's and HOA's steps are guided tours through existing generic
 * capabilities (dues, payment imports, users & roles, communications).
 */
export default async function OnboardingChecklistPage() {
  const { organizationId, session } = await requireOrganization();
  const vertical: OrganizationVertical = session.primaryVertical ?? "COMMUNITY";
  const terminology = getVerticalTerminology(vertical);

  const [organization, memberCount, eventCount, campaignCount, duesCategoryCount, checkoffImportCount, staffCount] =
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
    HOA: [
      { title: "Add board information", description: "Assign board member access under Users & Roles.", href: "/settings/users", linkLabel: "Go to Users & Roles", done: staffCount > 0 },
      { title: "Invite residents", description: "Add your first residents to the roster.", href: "/members/new", linkLabel: "Add a Resident", done: memberCount > 0 },
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

      {vertical === "HOA" ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>
            <strong>Property count</strong> — HOA properties are tracked as members for now (one member per unit/property).
            A dedicated property registry is not yet built.
          </p>
          <p className="mt-2 font-medium">Additional HOA capabilities will appear as they are enabled.</p>
        </div>
      ) : null}

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
