import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { withApiErrorHandling } from "@/lib/api-route";
import { parseJsonBody, z } from "@/lib/validation";
import { requireOrganizationLabFeature } from "@/lib/labs/access";
import type { Role } from "@/lib/rbac";
import {
  applyResponsePolicy,
  assertValidQuestion,
  containsUnsafeRequestPattern,
  FALLBACK_MESSAGE,
  getSupportAssistantProvider,
  retrieveKnowledgeChunks,
  KNOWLEDGE_DOCUMENTS,
  SupportAssistantError,
} from "@/lib/support-assistant";
import type { SupportAssistantContext, SupportAssistantRoleCategory } from "@/lib/support-assistant/types";
import { enforceAuthenticatedUsageLimits, enforcePublicUsageLimits, estimateTokens, recordAuthenticatedUsage } from "@/lib/support-assistant/usage-limiter";

const requestSchema = z.object({
  question: z.string().min(1).max(2000),
  currentPath: z.string().trim().max(300).optional(),
});

function roleCategory(role: Role): SupportAssistantRoleCategory {
  if (role === "SUPER_ADMIN" || role === "ORG_OWNER" || role === "ORG_ADMIN") return "admin";
  if (role === "MEMBER") return "member";
  return "staff";
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, requestSchema);
    const question = assertValidQuestion(input.question);

    // Session is resolved but never trusted for org/role/vertical from the
    // client -- the client cannot supply organizationId, role, or vertical;
    // everything server-scoped comes from this session lookup only.
    const session = await getServerSession(authOptions);
    const isAuthenticated = Boolean(session?.userId && session?.organizationId && session?.role);

    let context: SupportAssistantContext;
    if (isAuthenticated) {
      const organizationId = session!.organizationId!;
      await requireOrganizationLabFeature(organizationId, "supportAssistant");
      await enforceAuthenticatedUsageLimits(request, organizationId);
      context = {
        mode: "authenticated",
        vertical: session!.primaryVertical ?? null,
        roleCategory: roleCategory(session!.role!),
        currentPath: input.currentPath ?? null,
      };
    } else {
      if (process.env.SUPPORT_ASSISTANT_PUBLIC_ENABLED !== "1") {
        throw new SupportAssistantError("SUPPORT_ASSISTANT_DISABLED", "The Support Assistant isn't available yet.");
      }
      await enforcePublicUsageLimits(request);
      context = { mode: "public", vertical: null, roleCategory: "unknown", currentPath: input.currentPath ?? null };
    }

    // Checked independently of retrieval -- see containsUnsafeRequestPattern's
    // own doc comment for why topical grounding alone can't catch these
    // (e.g. a private-data request and a legitimate "how does dues tracking
    // work" question share the same vocabulary). Usage is still counted
    // below for a caught unsafe question, same as any other request.
    const isUnsafe = containsUnsafeRequestPattern(question);
    const chunks = isUnsafe
      ? []
      : retrieveKnowledgeChunks({
          question,
          visibility: context.mode === "authenticated" ? "in_app" : "public",
          vertical: context.vertical,
        });

    const answer = isUnsafe
      ? { answer: FALLBACK_MESSAGE, citations: [], confidence: "low" as const }
      : applyResponsePolicy({ chunks, answer: await getSupportAssistantProvider().respond({ question, context, chunks }) });

    if (context.mode === "authenticated") {
      await recordAuthenticatedUsage(session!.organizationId!, estimateTokens(question, answer.answer));
    }

    const topCategory = chunks[0] ? KNOWLEDGE_DOCUMENTS.find((doc) => doc.id === chunks[0].documentId)?.category : undefined;

    return Response.json({
      ok: true,
      data: {
        answer: answer.answer,
        citations: answer.citations,
        mode: context.mode,
        questionCategory: topCategory ?? "unmatched",
      },
    });
  });
}
