import { z } from "zod";
import { SupportAssistantError } from "../errors";
import { formatChunksForPrompt, SUPPORT_ASSISTANT_SYSTEM_PROMPT } from "../policy";
import type { SupportAssistantAnswer, SupportAssistantProvider, SupportAssistantRequest } from "../types";

const MODEL = "gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_TOKENS = 500;

const responseSchema = z.object({
  answer: z.string(),
  citedDocumentIds: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
});

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mirrors src/lib/labs/meeting-intelligence/minutes/openai-generator.ts's
 * pattern: raw fetch (no SDK), lazy key read, AbortController timeout,
 * structured error classification, and strict Zod validation of the model's
 * JSON output before anything downstream trusts it.
 */
export class OpenAISupportAssistantProvider implements SupportAssistantProvider {
  readonly id = "openai";
  readonly displayName = "Unestra Assistant";

  constructor(private readonly apiKey: string) {}

  async respond(request: SupportAssistantRequest): Promise<SupportAssistantAnswer> {
    const referenceMaterial = formatChunksForPrompt(request.chunks);
    const userMessage = `Reference material:\n${referenceMaterial || "(none retrieved for this question)"}\n\nQuestion: ${request.question}\n\nRespond with JSON: {"answer": string, "citedDocumentIds": string[], "confidence": "high"|"medium"|"low"}.`;

    let response: Response;
    try {
      response = await fetchWithTimeout(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: MODEL,
            response_format: { type: "json_object" },
            max_tokens: MAX_RESPONSE_TOKENS,
            messages: [
              { role: "system", content: SUPPORT_ASSISTANT_SYSTEM_PROMPT },
              { role: "user", content: userMessage },
            ],
          }),
        },
        REQUEST_TIMEOUT_MS
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new SupportAssistantError("SUPPORT_ASSISTANT_PROVIDER_TIMEOUT", "The assistant took too long to respond.");
      }
      throw new SupportAssistantError("SUPPORT_ASSISTANT_PROVIDER_ERROR", "Unable to reach the assistant provider.");
    }

    if (response.status === 429) {
      throw new SupportAssistantError("SUPPORT_ASSISTANT_PROVIDER_RATE_LIMITED", "The assistant provider is rate-limiting requests.");
    }
    if (!response.ok) {
      throw new SupportAssistantError("SUPPORT_ASSISTANT_PROVIDER_ERROR", `Assistant provider returned status ${response.status}.`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SupportAssistantError("SUPPORT_ASSISTANT_INVALID_PROVIDER_RESPONSE", "Assistant provider returned an unparseable response.");
    }

    const content = (body as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content;
    if (!content) {
      throw new SupportAssistantError("SUPPORT_ASSISTANT_INVALID_PROVIDER_RESPONSE", "Assistant provider response had no content.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new SupportAssistantError("SUPPORT_ASSISTANT_INVALID_PROVIDER_RESPONSE", "Assistant provider returned malformed JSON.");
    }

    const result = responseSchema.safeParse(parsed);
    if (!result.success) {
      // Malformed AI output is rejected safely rather than accepted as-is,
      // same rationale as the Meeting Intelligence generator.
      throw new SupportAssistantError("SUPPORT_ASSISTANT_INVALID_PROVIDER_RESPONSE", "Assistant provider response didn't match the expected shape.");
    }

    const citations = result.data.citedDocumentIds
      .map((id) => request.chunks.find((chunk) => chunk.documentId === id))
      .filter((chunk): chunk is NonNullable<typeof chunk> => Boolean(chunk))
      .map((chunk) => ({ title: chunk.title, href: chunk.href }));

    return {
      answer: result.data.answer,
      citations,
      confidence: result.data.confidence,
    };
  }
}
