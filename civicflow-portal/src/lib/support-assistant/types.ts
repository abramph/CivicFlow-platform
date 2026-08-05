import type { OrganizationVertical } from "@prisma/client";

export type SupportAssistantMode = "public" | "authenticated";

/** Broad role category only -- never a raw RBAC permission list, and never
 * anything that could leak org-specific structure to a public surface. */
export type SupportAssistantRoleCategory = "admin" | "staff" | "member" | "unknown";

export type SupportAssistantContext = {
  mode: SupportAssistantMode;
  /** Server-resolved only -- never trust a client-supplied vertical. */
  vertical: OrganizationVertical | null;
  roleCategory: SupportAssistantRoleCategory;
  /** Current route the user was on when they opened the assistant, for topical relevance only. */
  currentPath: string | null;
};

export type KnowledgeChunk = {
  documentId: string;
  title: string;
  href: string;
  text: string;
};

export type SupportAssistantCitation = {
  title: string;
  href: string;
};

export type SupportAssistantAnswer = {
  answer: string;
  citations: SupportAssistantCitation[];
  /** Whether the provider judged its own answer well-grounded in the retrieved
   * chunks. The policy layer, not the provider, decides what to do with this. */
  confidence: "high" | "medium" | "low";
};

export type SupportAssistantRequest = {
  question: string;
  context: SupportAssistantContext;
  chunks: KnowledgeChunk[];
};

/**
 * Every Support Assistant model call goes through this interface -- no route,
 * API handler, or UI component should ever import an OpenAI SDK or call
 * fetch() against a model API directly. Mirrors
 * MeetingTranscriptionProvider (src/lib/labs/meeting-intelligence/providers/types.ts).
 */
export interface SupportAssistantProvider {
  readonly id: string;
  readonly displayName: string;
  respond(request: SupportAssistantRequest): Promise<SupportAssistantAnswer>;
}
