import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { requireMemberIntakeManage, createFormField } from "@/lib/member-intake/forms";

const fieldSchema = z.object({
  fieldKey: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Field key must start with a letter and contain only letters, numbers, and underscores."),
  label: z.string().trim().min(1).max(160),
  fieldType: z.enum(["TEXT", "TEXTAREA", "EMAIL", "PHONE", "ADDRESS", "DATE", "SELECT", "MULTISELECT", "CHECKBOX", "RADIO", "BOOLEAN", "NUMBER"]),
  required: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
  placeholder: z.union([z.string().trim().max(200), z.literal(""), z.null()]).optional(),
  helpText: z.union([z.string().trim().max(500), z.literal(""), z.null()]).optional(),
  options: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
  targetEntity: z.enum(["MEMBER", "CUSTOM"]),
  targetField: z.union([z.string().trim().min(1), z.null()]).optional(),
  sensitivity: z.enum(["LOW", "MODERATE", "HIGH"]).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:member-intake:forms:write", request, limit: 60, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, session } = await requireMemberIntakeManage();
    const { id } = await params;
    const input = await parseJsonBody(request, fieldSchema);

    const field = await createFormField(organizationId, id, session.userId, {
      ...input,
      placeholder: input.placeholder || null,
      helpText: input.helpText || null,
    });

    return Response.json({ ok: true, data: field }, { status: 201 });
  });
}
