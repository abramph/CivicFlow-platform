import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { createContact, listContacts } from "@/lib/contacts";
import { parseJsonBody, z } from "@/lib/validation";

/** GET /api/contacts[?includeInactive=1] — the institutional directory. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("contacts:read", "throw");
    const { searchParams } = new URL(request.url);
    const rows = await listContacts(organizationId, { includeInactive: searchParams.get("includeInactive") === "1" });
    return Response.json({ ok: true, data: rows });
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  contactPerson: z.string().max(200).nullable().optional(),
  role: z.string().max(200).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  website: z.string().max(300).nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  isVendor: z.boolean().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("contacts:write", "throw");
    const input = await parseJsonBody(request, createSchema);
    const contact = await createContact({
      organizationId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: contact }, { status: 201 });
  });
}
