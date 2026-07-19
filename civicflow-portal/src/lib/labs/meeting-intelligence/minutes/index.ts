import { deterministicMinutesGenerator } from "./deterministic-generator";
import { openAiMinutesGenerator } from "./openai-generator";
import { getOpenAiApiKey } from "../config";
import type { MeetingMinutesGenerationInput, MeetingMinutesGenerator, StructuredMeetingMinutes } from "./types";

export type { MeetingMinutesGenerationInput, MeetingMinutesGenerator, StructuredMeetingMinutes, EvidenceReference, StructuredMotion, StructuredActionItem } from "./types";
export { AI_GENERATED_DISCLAIMER, DETERMINISTIC_FALLBACK_DISCLAIMER } from "./types";

/**
 * Resolves the minutes generator to use: OpenAI when OPENAI_API_KEY is
 * configured, otherwise the deterministic non-AI fallback — so local
 * development and CI never require a live credential, and a missing key
 * never crashes the pipeline, it just produces a more conservative
 * (extraction-only, zero-inference) draft instead.
 */
export function resolveMeetingMinutesGenerator(): MeetingMinutesGenerator {
  return getOpenAiApiKey() ? openAiMinutesGenerator : deterministicMinutesGenerator;
}

export async function generateMeetingMinutes(input: MeetingMinutesGenerationInput): Promise<{ result: StructuredMeetingMinutes; generatorId: string }> {
  const generator = resolveMeetingMinutesGenerator();
  const result = await generator.generate(input);
  return { result, generatorId: generator.id };
}
