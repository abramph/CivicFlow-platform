import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { prisma } from "@/lib/prisma";

/** CORE-GIVE-B — the member's own contribution history (§93). Scoping lives
 * in the query itself: rows where the caller is the member or the
 * contributor — never filtered client-side, never anyone else's rows. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("org") ?? "";
    const memberSession = await requireMemberWebSession(organizationId);
    const yearParam = Number(searchParams.get("year"));
    const year = Number.isInteger(yearParam) && yearParam > 2000 ? yearParam : null;

    const rows = await prisma.contribution.findMany({
      where: {
        organizationId: memberSession.organizationId,
        voidedAt: null,
        OR: [{ memberId: memberSession.memberId }, { contributorUserId: memberSession.userId }],
        ...(year
          ? { contributionDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } }
          : {}),
      },
      orderBy: { contributionDate: "desc" },
      select: {
        id: true,
        contributionNumber: true,
        amount: true,
        currency: true,
        contributionDate: true,
        fund: { select: { name: true } },
        contributionProgram: { select: { name: true } },
        campaign: { select: { name: true } },
        anonymityMode: true,
      },
      take: 200,
    });

    return Response.json({
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        contributionNumber: row.contributionNumber,
        amount: Number(row.amount),
        currency: row.currency,
        date: row.contributionDate,
        designation: row.fund?.name ?? row.campaign?.name ?? "General",
        program: row.contributionProgram?.name ?? null,
        anonymityMode: row.anonymityMode,
      })),
    });
  });
}
