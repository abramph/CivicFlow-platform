import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { ensureContributionsEnabled } from "@/lib/giving/module";
import { createHousehold } from "@/lib/giving/households";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

/** CORE-GIVE-H — household roster admin. Households are membership
 * structure, so this sits under members:read/write, not the giving
 * capabilities; the giving PRIVACY controls stay on the giving settings
 * route. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("members:read", "throw");
    await ensureContributionsEnabled(organizationId);
    const households = await prisma.household.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      include: { members: { select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } } },
      take: 500,
    });
    return Response.json({
      ok: true,
      data: households.map((household) => ({
        id: household.id,
        name: household.name,
        members: household.members.map((member) => ({
          id: member.id,
          name: `${member.firstName} ${member.lastName}`.trim(),
        })),
      })),
    });
  });
}

const postSchema = z.object({
  name: z.string().min(1).max(120),
  addressLine1: z.string().max(200).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(50).nullable().optional(),
  zipCode: z.string().max(20).nullable().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("members:write", "throw");
    const input = await parseJsonBody(request, postSchema);
    const household = await createHousehold({
      organizationId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: { id: household.id, name: household.name } }, { status: 201 });
  });
}
