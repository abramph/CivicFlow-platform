import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { ensureContributionsEnabled } from "@/lib/giving/module";
import { generateStatement, statementExceptions } from "@/lib/giving/statements";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

/** GET /api/giving/statements?year= — admin list + §96 exception report. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("contributions:statements:generate", "throw");
    await ensureContributionsEnabled(organizationId);
    const { searchParams } = new URL(request.url);
    const year = Number(searchParams.get("year")) || new Date().getFullYear();

    const [statements, exceptions] = await Promise.all([
      prisma.contributionStatement.findMany({
        where: { organizationId, year },
        orderBy: [{ generatedAt: "desc" }],
        include: {
          member: { select: { firstName: true, lastName: true } },
          contributorUser: { select: { displayName: true, email: true } },
        },
        take: 500,
      }),
      statementExceptions(organizationId, year),
    ]);
    return Response.json({
      ok: true,
      data: {
        year,
        exceptions,
        statements: statements.map((statement) => ({
          id: statement.id,
          subject: statement.member
            ? `${statement.member.firstName} ${statement.member.lastName}`.trim()
            : (statement.contributorUser?.displayName ?? statement.contributorUser?.email ?? "—"),
          version: statement.version,
          status: statement.status,
          total: Number(statement.totalAmount),
          contributionCount: statement.contributionCount,
          generatedAt: statement.generatedAt,
        })),
      },
    });
  });
}

const postSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  /** Generate for every subject with eligible contributions. §95: this
   * PREPARES statements — it never emails anyone. */
  all: z.boolean().optional(),
  memberId: z.string().max(64).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("contributions:statements:generate", "throw");
    await ensureContributionsEnabled(organizationId);
    const input = await parseJsonBody(request, postSchema);
    const actor = { generatedByUserId: session.userId, generatedByEmail: session.userEmail };

    if (input.memberId) {
      const member = await prisma.orgMember.findFirst({ where: { id: input.memberId, organizationId } });
      if (!member) return Response.json({ ok: false, error: "Member not found." }, { status: 404 });
      const statement = await generateStatement({
        organizationId,
        subject: { memberId: member.id, contributorUserId: member.userId },
        subjectName: `${member.firstName} ${member.lastName}`.trim(),
        year: input.year,
        reason: input.reason ?? null,
        ...actor,
      });
      return Response.json({ ok: true, data: { generated: 1, statementId: statement.id } }, { status: 201 });
    }

    if (!input.all) return Response.json({ ok: false, error: "Provide memberId or all: true." }, { status: 400 });

    // Bulk: every member with eligible contributions in the year, skipping
    // subjects that already have a current statement (reissues are explicit).
    const periodStart = new Date(Date.UTC(input.year, 0, 1));
    const periodEnd = new Date(Date.UTC(input.year + 1, 0, 1));
    const memberIds = await prisma.contribution.findMany({
      where: {
        organizationId,
        voidedAt: null,
        statementEligible: true,
        memberId: { not: null },
        contributionDate: { gte: periodStart, lt: periodEnd },
      },
      select: { memberId: true },
      distinct: ["memberId"],
      take: 2000,
    });

    let generated = 0;
    let skipped = 0;
    for (const row of memberIds) {
      const existing = await prisma.contributionStatement.findFirst({
        where: { organizationId, year: input.year, memberId: row.memberId, status: "GENERATED" },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      const member = await prisma.orgMember.findFirst({ where: { id: row.memberId!, organizationId } });
      if (!member) continue;
      await generateStatement({
        organizationId,
        subject: { memberId: member.id, contributorUserId: member.userId },
        subjectName: `${member.firstName} ${member.lastName}`.trim(),
        year: input.year,
        ...actor,
      });
      generated += 1;
    }
    return Response.json({ ok: true, data: { generated, skipped } }, { status: 201 });
  });
}
