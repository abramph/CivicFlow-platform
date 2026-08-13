import { withApiErrorHandling } from "@/lib/api-route";
import { requireCommitteeManageOrChair } from "@/lib/labs/pta/guard";
import { prisma } from "@/lib/prisma";

/**
 * PTA-B: committee-scoped adult search for building a committee's roster —
 * usable by officers AND by this committee's own chair/co-chair. Returns
 * names and household display names ONLY (never email/phone/students):
 * a chair recruiting members needs to find people by name, not read the
 * membership directory's contact data.
 */
export async function GET(request: Request, { params }: { params: Promise<{ committeeId: string }> }) {
  return withApiErrorHandling(async () => {
    const { committeeId } = await params;
    const { organizationId } = await requireCommitteeManageOrChair(committeeId);
    const search = new URL(request.url).searchParams.get("search")?.trim() ?? "";
    if (!search) return Response.json({ ok: true, data: [] });

    const adults = await prisma.ptaHouseholdAdult.findMany({
      where: {
        organizationId,
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { household: { displayName: { contains: search, mode: "insensitive" } } },
        ],
      },
      select: { id: true, name: true, household: { select: { displayName: true } } },
      orderBy: { name: "asc" },
      take: 25,
    });

    return Response.json({
      ok: true,
      data: adults.map((adult) => ({ id: adult.id, name: adult.name, householdName: adult.household.displayName })),
    });
  });
}
