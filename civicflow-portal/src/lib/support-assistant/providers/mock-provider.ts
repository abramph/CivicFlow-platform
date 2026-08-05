import type { SupportAssistantAnswer, SupportAssistantProvider, SupportAssistantRequest } from "../types";

/**
 * Deterministic, no network call, always available -- used whenever
 * OPENAI_API_KEY isn't configured (the default state today) and in every
 * test. Implements the exact same contract as the real provider: an answer
 * grounded in the retrieved chunks, with citations, or low confidence when
 * nothing relevant was retrieved.
 */
export class MockSupportAssistantProvider implements SupportAssistantProvider {
  readonly id = "mock";
  readonly displayName = "Unestra Assistant (offline reference mode)";

  async respond(request: SupportAssistantRequest): Promise<SupportAssistantAnswer> {
    if (request.chunks.length === 0) {
      return { answer: "", citations: [], confidence: "low" };
    }
    const primary = request.chunks[0];
    const answer = request.chunks.length === 1 ? primary.text : `${primary.text} (${primary.title})`;
    return {
      answer,
      citations: request.chunks.map((chunk) => ({ title: chunk.title, href: chunk.href })),
      confidence: "high",
    };
  }
}
