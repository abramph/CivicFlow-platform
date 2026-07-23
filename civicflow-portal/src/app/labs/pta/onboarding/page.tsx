import Link from "next/link";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";

interface Step {
  title: string;
  description: string;
  href: string;
  linkLabel: string;
  done: boolean;
}

export default async function PtaOnboardingPage() {
  const { organizationId, access } = await getPtaPageGate("pta:households:manage");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Setup Checklist" description="Not available for this organization." />
      </main>
    );
  }

  const profile = await getPtaProfile(organizationId);
  const schoolYear = profile?.currentSchoolYear;

  const [gradesCount, householdsCount, committeesCount, duesChargeCount, opportunityCount] = await Promise.all([
    prisma.ptaGrade.count({ where: { organizationId } }),
    schoolYear ? prisma.ptaHousehold.count({ where: { organizationId, schoolYear } }) : Promise.resolve(0),
    prisma.ptaCommittee.count({ where: { organizationId } }),
    prisma.duesCharge.count({ where: { organizationId, member: { ptaHouseholdBilling: { isNot: null } } } }),
    prisma.ptaVolunteerOpportunity.count({ where: { organizationId } }),
  ]);

  const steps: Step[] = [
    { title: "Configure your school", description: "Set your school/PTA name, designation, and current school year.", href: "/labs/pta/settings", linkLabel: "Go to Settings", done: Boolean(profile) },
    { title: "Create grades", description: "Add the grades your school serves (e.g. Kindergarten, 1st Grade).", href: "/labs/pta/academic", linkLabel: "Go to Academic", done: gradesCount > 0 },
    { title: "Create classrooms", description: "Add classrooms within each grade, optionally assigning a teacher.", href: "/labs/pta/academic", linkLabel: "Go to Academic", done: gradesCount > 0 },
    { title: "Add households", description: "Add each family, their adults, and their students.", href: "/labs/pta/households/new", linkLabel: "Add a household", done: householdsCount > 0 },
    { title: "Create committees", description: "Set up your standing committees and assign chairs.", href: "/labs/pta/committees", linkLabel: "Go to Committees", done: committeesCount > 0 },
    { title: "Create this year's dues", description: "Create a dues charge for each household from their own page.", href: "/labs/pta/dues", linkLabel: "Go to Dues", done: duesChargeCount > 0 },
    { title: "Post a volunteer opportunity", description: "Let parents sign up for shifts at your next event.", href: "/labs/pta/volunteers/manage", linkLabel: "Go to Volunteers", done: opportunityCount > 0 },
    {
      title: "Invite parents",
      description: "Link a household adult to a platform account by adding them with an existing user's email — inviting brand-new users into the organization itself is a base-platform action, not a PTA-specific one.",
      href: "/labs/pta/households",
      linkLabel: "Go to Households",
      done: householdsCount > 0,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader title="Setup Checklist" description={`${completedCount} of ${steps.length} steps complete. This is instructional — every link goes to a real, working page.`} />

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
