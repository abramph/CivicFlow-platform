import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { requireMemberIntakeManage, requireMemberIntakeView, createIntakeForm, listIntakeForms, type IntakeFormInput } from "@/lib/member-intake/forms";

const optionalTextField = (maxLength: number) => z.union([z.string().trim().max(maxLength), z.literal(""), z.null()]).optional();

const createFormSchema = z.object({
  name: z.string().trim().min(1).max(160),
  purpose: z.enum(["NEW_MEMBER", "PROFILE_UPDATE", "NEW_OR_UPDATE", "CONTACT_UPDATE", "HOUSEHOLD_UPDATE", "VISITOR_CONNECT", "CUSTOM"]),
  title: z.string().trim().min(1).max(160),
  description: optionalTextField(2000),
  successMessage: optionalTextField(2000),
  requireVerificationForExisting: z.boolean().optional(),
  autoCreateNewMember: z.boolean().optional(),
  autoApplySafeUpdates: z.boolean().optional(),
  requireReviewForSensitiveUpdates: z.boolean().optional(),
  duplicateHandlingMode: z.enum(["REVIEW", "AUTO_LINK_CONFIDENT"]).optional(),
  expiresAt: z.union([z.string().datetime(), z.literal(""), z.null()]).optional(),
});

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireMemberIntakeView();
    const forms = await listIntakeForms(organizationId);
    return Response.json({ ok: true, data: forms });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:member-intake:forms:write", request, limit: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, session } = await requireMemberIntakeManage();
    const input = await parseJsonBody(request, createFormSchema);

    const form = await createIntakeForm(organizationId, session.userId, {
      ...input,
      description: input.description || null,
      successMessage: input.successMessage || null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    } as IntakeFormInput);

    return Response.json({ ok: true, data: form }, { status: 201 });
  });
}
