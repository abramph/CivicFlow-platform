import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { getVendorHistory, updateContact } from "@/lib/contacts";
import { parseJsonBody, z } from "@/lib/validation";

/** GET /api/contacts/:id — the contact plus computed §24 vendor history
 * (spend, events, recent expenditures matched by vendor name). */
export async function GET(_request: Request, { params }: { params: Promise<{ contactId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("contacts:read", "throw");
    const { contactId } = await params;
    const history = await getVendorHistory(organizationId, contactId);
    return Response.json({ ok: true, data: history });
  });
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  contactPerson: z.string().max(200).nullable().optional(),
  role: z.string().max(200).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  website: z.string().max(300).nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  isVendor: z.boolean().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  isActive: z.boolean().optional(),
  markReviewed: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ contactId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("contacts:write", "throw");
    const { contactId } = await params;
    const input = await parseJsonBody(request, patchSchema);
    const contact = await updateContact({
      organizationId,
      contactId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: contact });
  });
}
