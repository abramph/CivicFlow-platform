import { recordLabUsage } from "@/lib/labs/usage";
import type { ProviderId } from "./providers";

/**
 * Meeting Intelligence — usage metering. Composes the generic
 * recordLabUsage() interface from the Labs foundation; never connected to
 * Stripe, never used to charge a customer or create an invoice. Metadata
 * is always a flat record of counts/identifiers/estimates — never
 * transcript text, meeting titles, attendee names, or recording filenames.
 * Cost figures are always estimates derived from isolated, documented
 * vendor-pricing constants (see cost-constants.ts) that must be reviewed
 * periodically, not treated as a live quote.
 *
 * `recordMeetingIntelligenceUsage` below is the original technical-spike
 * (PR #14) helper, used by the mock pipeline under
 * /labs/meeting-intelligence-spike — kept unchanged so that prototype
 * keeps working. Everything else in this file is new for the production
 * MVP's real job pipeline.
 */

export interface MeetingIntelligenceUsageInput {
  organizationId: string;
  providerId: ProviderId;
  durationMs: number;
  processingMs: number;
  estimatedCostCents: number;
}

export async function recordMeetingIntelligenceUsage(input: MeetingIntelligenceUsageInput): Promise<void> {
  await recordLabUsage({
    organizationId: input.organizationId,
    featureKey: "meetingIntelligence",
    unit: "audio_minutes",
    quantity: input.durationMs / 60_000,
    metadata: {
      provider: input.providerId,
      processingMs: input.processingMs,
      estimatedCostCents: Math.round(input.estimatedCostCents),
    },
  });
}

export async function recordAudioMinutesUploaded(organizationId: string, jobId: string, minutes: number) {
  await recordLabUsage({
    organizationId,
    featureKey: "meetingIntelligence",
    unit: "audio_minutes_uploaded",
    quantity: minutes,
    metadata: { jobId },
  });
}

export async function recordTranscriptionJob(organizationId: string, jobId: string, provider: string) {
  await recordLabUsage({
    organizationId,
    featureKey: "meetingIntelligence",
    unit: "transcription_jobs",
    quantity: 1,
    metadata: { jobId, provider },
  });
}

export async function recordAudioMinutesTranscribed(organizationId: string, jobId: string, minutes: number, provider: string, estimatedCostCents: number) {
  await recordLabUsage({
    organizationId,
    featureKey: "meetingIntelligence",
    unit: "audio_minutes_transcribed",
    quantity: minutes,
    metadata: { jobId, provider },
  });
  await recordLabUsage({
    organizationId,
    featureKey: "meetingIntelligence",
    unit: "transcription_provider_cost_estimate",
    quantity: Math.round(estimatedCostCents),
    metadata: { jobId, provider, unit: "cents", estimate: true },
  });
}

export async function recordMinutesGenerationJob(organizationId: string, jobId: string, generatorId: string, estimatedCostCents: number) {
  await recordLabUsage({
    organizationId,
    featureKey: "meetingIntelligence",
    unit: "minutes_generation_jobs",
    quantity: 1,
    metadata: { jobId, generator: generatorId },
  });
  await recordLabUsage({
    organizationId,
    featureKey: "meetingIntelligence",
    unit: "generation_cost_estimate",
    quantity: Math.round(estimatedCostCents),
    metadata: { jobId, generator: generatorId, unit: "cents", estimate: true },
  });
}
