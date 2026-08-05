import { MockSupportAssistantProvider } from "./providers/mock-provider";
import { OpenAISupportAssistantProvider } from "./providers/openai-provider";
import type { SupportAssistantProvider } from "./types";

function getOpenAiApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY || undefined;
}

/** No key configured (the default state today) -> Mock. Configured -> OpenAI.
 * Mirrors the selection in src/lib/labs/meeting-intelligence/minutes/index.ts.
 * A single kill switch (unsetting the key) instantly reverts every caller to
 * the mock provider with no code path change. */
export function getSupportAssistantProvider(): SupportAssistantProvider {
  const apiKey = getOpenAiApiKey();
  if (apiKey) {
    return new OpenAISupportAssistantProvider(apiKey);
  }
  return new MockSupportAssistantProvider();
}

export * from "./types";
export * from "./errors";
export * from "./policy";
export { retrieveKnowledgeChunks } from "./knowledge/retriever";
export { KNOWLEDGE_DOCUMENTS } from "./knowledge/manifest";
