import { z } from "zod";
import { MeetingIntelligenceError } from "../errors";
import { getOpenAiApiKey } from "../config";
import { AI_GENERATED_DISCLAIMER, type MeetingMinutesGenerationInput, type MeetingMinutesGenerator, type StructuredMeetingMinutes } from "./types";

/**
 * Real OpenAI adapter for minutes generation. No credentials are
 * hardcoded — OPENAI_API_KEY is read from process.env only at call time
 * (same convention as ASSEMBLYAI_API_KEY, see env.ts). The model's JSON
 * response is strictly validated against `responseSchema` before being
 * trusted at all; `status` and `aiDisclaimer` are always set server-side
 * regardless of what the model returns, so a prompt-injection attempt
 * inside the transcript text can never cause generated content to claim
 * anything other than draft status.
 */

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 60_000;
const MODEL = "gpt-4o-mini";

const evidenceSchema = z.object({ segmentIndex: z.number().int(), startMs: z.number(), endMs: z.number() });

const responseSchema = z.object({
  meetingDate: z.string().nullable().optional(),
  locationOrFormat: z.string().nullable().optional(),
  attendance: z.array(z.object({ speakerLabel: z.string(), attendeeName: z.string().nullable() })).optional(),
  agendaItems: z.array(z.string()).optional(),
  discussionSummaries: z.array(z.object({ topic: z.string(), summary: z.string(), evidence: z.array(evidenceSchema).optional() })).optional(),
  motions: z
    .array(
      z.object({
        text: z.string(),
        proposedBy: z.string().nullable().optional(),
        secondedBy: z.string().nullable().optional(),
        voteResult: z.enum(["passed", "failed", "unrecorded"]).optional(),
        evidence: z.array(evidenceSchema).optional(),
      })
    )
    .optional(),
  decisions: z.array(z.string()).optional(),
  actionItems: z
    .array(
      z.object({
        description: z.string(),
        owner: z.string().nullable().optional(),
        dueDate: z.string().nullable().optional(),
        evidence: z.array(evidenceSchema).optional(),
      })
    )
    .optional(),
  unresolvedIssues: z.array(z.string()).optional(),
  nextMeetingDetails: z.string().nullable().optional(),
  adjournmentTime: z.string().nullable().optional(),
  executiveSummary: z.string().nullable().optional(),
});

function getApiKey(): string {
  const key = getOpenAiApiKey();
  if (!key) {
    throw new MeetingIntelligenceError(
      "MEETING_INTELLIGENCE_GENERATION_FAILED",
      "OPENAI_API_KEY is not configured. Falling back to the deterministic generator is expected in this environment."
    );
  }
  return key;
}

const SYSTEM_PROMPT = `You produce structured draft meeting minutes from a transcript. Rules you must follow exactly:
- Only extract information that is explicitly present in the transcript. Never invent names, motions, vote counts, owners, due dates, decisions, attendance, or legal conclusions.
- If a field is not clearly supported by the transcript, omit it or set it to null. Do not guess.
- Every motion/action item/discussion summary should reference the transcript segment index/indices it was drawn from in its "evidence" array.
- Respond with strict JSON matching the requested schema. No prose outside the JSON.`;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_PROVIDER_TIMEOUT", "The minutes-generation provider did not respond in time.");
    }
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_GENERATION_FAILED", "Unable to reach the minutes-generation provider.");
  } finally {
    clearTimeout(timeout);
  }
}

export const openAiMinutesGenerator: MeetingMinutesGenerator = {
  id: "openai",
  async generate(input: MeetingMinutesGenerationInput): Promise<StructuredMeetingMinutes> {
    const apiKey = getApiKey();

    const transcriptForPrompt = input.segments
      .map((segment, index) => `[${index}] ${input.speakerLabelMap?.[segment.speakerLabel] ?? segment.speakerLabel}: ${segment.text}`)
      .join("\n");

    const response = await fetchWithTimeout(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Meeting title: ${input.meetingTitle}\nAgenda: ${(input.agendaItems ?? []).join(", ") || "(none provided)"}\n\nTranscript segments:\n${transcriptForPrompt}`,
          },
        ],
      }),
    });

    if (response.status === 429) {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_PROVIDER_RATE_LIMITED", "Minutes-generation provider rate limit exceeded.");
    }
    if (!response.ok) {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_GENERATION_FAILED", `Minutes-generation provider returned an unexpected error (${response.status}).`);
    }

    let body: { choices?: Array<{ message?: { content?: string } }> };
    try {
      body = await response.json();
    } catch {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_INVALID_PROVIDER_RESPONSE", "Minutes-generation provider returned an unparseable response.");
    }

    const rawContent = body.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_INVALID_PROVIDER_RESPONSE", "Minutes-generation provider response had no content.");
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawContent);
    } catch {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_GENERATION_FAILED", "Minutes-generation provider returned malformed JSON.");
    }

    const validated = responseSchema.safeParse(parsedJson);
    if (!validated.success) {
      // Malformed AI output is rejected safely rather than accepted as-is —
      // never surfaced to a user as if it were valid structured minutes.
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_GENERATION_FAILED", "Minutes-generation provider returned output that did not match the required structure.");
    }
    const data = validated.data;

    return {
      meetingTitle: input.meetingTitle,
      meetingDate: data.meetingDate ?? input.meetingDate ?? null,
      locationOrFormat: data.locationOrFormat ?? input.locationOrFormat ?? null,
      attendance: data.attendance ?? [],
      agendaItems: data.agendaItems ?? input.agendaItems ?? [],
      discussionSummaries: (data.discussionSummaries ?? []).map((s) => ({ ...s, evidence: s.evidence ?? [] })),
      motions: (data.motions ?? []).map((m) => ({
        text: m.text,
        proposedBy: m.proposedBy ?? null,
        secondedBy: m.secondedBy ?? null,
        voteResult: m.voteResult ?? "unrecorded",
        evidence: m.evidence ?? [],
      })),
      decisions: data.decisions ?? [],
      actionItems: (data.actionItems ?? []).map((a) => ({
        description: a.description,
        owner: a.owner ?? null,
        dueDate: a.dueDate ?? null,
        evidence: a.evidence ?? [],
      })),
      unresolvedIssues: data.unresolvedIssues ?? [],
      nextMeetingDetails: data.nextMeetingDetails ?? null,
      adjournmentTime: data.adjournmentTime ?? null,
      executiveSummary: data.executiveSummary ?? null,
      // Always server-set, never taken from the model's own output — a
      // transcript containing prompt-injection text can never cause
      // generated minutes to claim any status other than draft.
      status: "draft",
      aiDisclaimer: AI_GENERATED_DISCLAIMER,
    };
  },
};
