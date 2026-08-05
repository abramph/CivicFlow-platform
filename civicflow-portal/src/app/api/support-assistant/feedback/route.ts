import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { withApiErrorHandling } from "@/lib/api-route";
import { parseJsonBody, z } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { getOrganizationLabAccess } from "@/lib/labs/access";
import { sanitizeCurrentPath, SupportAssistantError } from "@/lib/support-assistant";

const feedbackSchema = z.object({
  currentPath: z.string().trim().max(300).optional(),
  questionCategory: z.string().trim().max(80),
  helpful: z.boolean().optional(),
  escalated: z.boolean().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:support-assistant:feedback", request, limit: 20, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const input = await parseJsonBody(request, feedbackSchema);
    const session = await getServerSession(authOptions);
    // Matches the main /api/support-assistant and availability routes' exact
    // isAuthenticated check -- mode is derived server-side, never trusted
    // from the request body.
    const isAuthenticated = Boolean(session?.userId && session?.organizationId && session?.role);

    // Gated the same way as the main endpoint: an unenrolled/disabled
    // feature must not accept feedback either -- otherwise a "disabled"
    // feature still leaves an ungated, unbounded write endpoint reachable
    // by anyone.
    if (isAuthenticated) {
      const access = await getOrganizationLabAccess(session!.organizationId!, "supportAssistant");
      if (!access.available) {
        throw new SupportAssistantError("SUPPORT_ASSISTANT_NOT_ENABLED", "The Support Assistant isn't available for this organization.");
      }
    } else if (process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED !== "1") {
      throw new SupportAssistantError("SUPPORT_ASSISTANT_DISABLED", "The Support Assistant isn't available yet.");
    }

    await prisma.supportAssistantFeedback.create({
      data: {
        organizationId: isAuthenticated ? session!.organizationId! : null,
        userId: isAuthenticated ? session!.userId! : null,
        mode: isAuthenticated ? "authenticated" : "public",
        vertical: isAuthenticated ? (session!.primaryVertical ?? null) : null,
        currentPath: input.currentPath ? sanitizeCurrentPath(input.currentPath) : null,
        questionCategory: input.questionCategory,
        helpful: input.helpful ?? null,
        escalated: input.escalated ?? false,
      },
    });

    return Response.json({ ok: true });
  });
}
