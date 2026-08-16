import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { requireMemberIntakeManage, requireMemberIntakeView, getIntakeForm, updateIntakeForm, type IntakeFormInput } from "@/lib/member-intake/forms";
import { getServerEnv } from "@/lib/env";

const optionalTextField = (maxLength: number) => z.union([z.string().trim().max(maxLength), z.literal(""), z.null()]).optional();

const updateFormSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  purpose: z.enum(["NEW_MEMBER", "PROFILE_UPDATE", "NEW_OR_UPDATE", "CONTACT_UPDATE", "HOUSEHOLD_UPDATE", "VISITOR_CONNECT", "CUSTOM"]).optional(),
  title: z.string().trim().min(1).max(160).optional(),
  description: optionalTextField(2000),
  successMessage: optionalTextField(2000),
  requireVerificationForExisting: z.boolean().optional(),
  autoCreateNewMember: z.boolean().optional(),
  autoApplySafeUpdates: z.boolean().optional(),
  requireReviewForSensitiveUpdates: z.boolean().optional(),
  duplicateHandlingMode: z.enum(["REVIEW", "AUTO_LINK_CONFIDENT"]).optional(),
  expiresAt: z.union([z.string().datetime(), z.literal(""), z.null()]).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireMemberIntakeView();
    const { id } = await params;
    const form = await getIntakeForm(organizationId, id);
    const publicUrl = `${getServerEnv().NEXTAUTH_URL.replace(/\/+$/, "")}/f/${form.publicToken}`;
    return Response.json({ ok: true, data: { ...form, publicUrl } });
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:member-intake:forms:write", request, limit: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, session } = await requireMemberIntakeManage();
    const { id } = await params;
    const input = await parseJsonBody(request, updateFormSchema);

    const patch: Partial<IntakeFormInput> = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(input.successMessage !== undefined ? { successMessage: input.successMessage || null } : {}),
      ...(input.requireVerificationForExisting !== undefined ? { requireVerificationForExisting: input.requireVerificationForExisting } : {}),
      ...(input.autoCreateNewMember !== undefined ? { autoCreateNewMember: input.autoCreateNewMember } : {}),
      ...(input.autoApplySafeUpdates !== undefined ? { autoApplySafeUpdates: input.autoApplySafeUpdates } : {}),
      ...(input.requireReviewForSensitiveUpdates !== undefined ? { requireReviewForSensitiveUpdates: input.requireReviewForSensitiveUpdates } : {}),
      ...(input.duplicateHandlingMode !== undefined ? { duplicateHandlingMode: input.duplicateHandlingMode } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } : {}),
    };

    const form = await updateIntakeForm(organizationId, id, session.userId, patch);
    return Response.json({ ok: true, data: form });
  });
}
