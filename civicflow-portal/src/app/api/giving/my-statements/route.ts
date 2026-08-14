import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { generateStatement } from "@/lib/giving/statements";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

/** CORE-GIVE-G — the member's own statements (query-scoped). */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const memberSession = await requireMemberWebSession(searchParams.get("org") ?? "");
    const statements = await prisma.contributionStatement.findMany({
      where: {
        organizationId: memberSession.organizationId,
        OR: [{ memberId: memberSession.memberId }, { contributorUserId: memberSession.userId }],
      },
      orderBy: [{ year: "desc" }, { version: "desc" }],
      select: { id: true, year: true, version: true, status: true, totalAmount: true, generatedAt: true },
    });
    return Response.json({
      ok: true,
      data: statements.map((statement) => ({
        id: statement.id,
        year: statement.year,
        version: statement.version,
        status: statement.status,
        total: Number(statement.totalAmount),
        generatedAt: statement.generatedAt,
      })),
    });
  });
}

const postSchema = z.object({
  organizationId: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
});

/** POST — member generates their OWN statement for a year (first version
 * only; reissues are an admin act with a reason). Audited. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:giving:my-statement", request, limit: 5, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const input = await parseJsonBody(request, postSchema);
    const memberSession = await requireMemberWebSession(input.organizationId);

    const existing = await prisma.contributionStatement.findFirst({
      where: {
        organizationId: memberSession.organizationId,
        year: input.year,
        status: "GENERATED",
        OR: [{ memberId: memberSession.memberId }, { contributorUserId: memberSession.userId }],
      },
    });
    if (existing) return Response.json({ ok: true, data: { id: existing.id, alreadyExists: true } });

    const user = await prisma.user.findUnique({ where: { id: memberSession.userId }, select: { displayName: true, email: true } });
    const statement = await generateStatement({
      organizationId: memberSession.organizationId,
      subject: { memberId: memberSession.memberId, contributorUserId: memberSession.userId },
      subjectName: user?.displayName || user?.email || "Member",
      year: input.year,
      generatedByUserId: memberSession.userId,
    });
    return Response.json({ ok: true, data: { id: statement.id, alreadyExists: false } }, { status: 201 });
  });
}
