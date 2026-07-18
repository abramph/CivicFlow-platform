import { getMeetingTranscriptionProvider, type ProviderId } from "./providers";

/**
 * Meeting Intelligence Technical Spike — cost model.
 *
 * All per-unit rates below are illustrative approximations based on public,
 * general-knowledge pricing for each category — not a live quote and not a
 * commitment. Confirm current rates directly with each vendor and DigitalOcean
 * before treating any of these numbers as a production budget. No Stripe
 * integration, no customer billing, no invoices are implied or built here.
 */

// Illustrative: a single LLM call to turn a transcript into structured
// draft minutes. Cost scales weakly with transcript length (more tokens in
// context), approximated here as a flat per-minute-of-audio rate for
// simplicity, since transcript length correlates with audio duration.
const SUMMARIZATION_CENTS_PER_MINUTE = 0.25;

// DigitalOcean Spaces: ~$0.02/GB-month storage, ~$0.01/GB egress bandwidth
// beyond the included allowance on the base tier — illustrative.
const STORAGE_CENTS_PER_GB_MONTH = 2;
const BANDWIDTH_CENTS_PER_GB = 1;

// Rough size-to-duration ratio for a compressed recording suitable for
// transcription (mono, ~32–64kbps) — used only to translate duration into
// an approximate storage footprint for the cost model, not a format spec.
const APPROX_MB_PER_MINUTE_OF_AUDIO = 0.5;

export interface MeetingCostBreakdownCents {
  transcriptionCents: number;
  summarizationCents: number;
  storageCents: number;
  bandwidthCents: number;
  totalCents: number;
}

/** Storage/bandwidth costs assume one processing pass and one month of raw-audio retention before deletion (see storage architecture — recordings are not kept permanently by default). */
export function estimateMeetingCostCents(durationMs: number, providerId: ProviderId): MeetingCostBreakdownCents {
  const provider = getMeetingTranscriptionProvider(providerId);
  const minutes = durationMs / 60_000;
  const approxGb = (minutes * APPROX_MB_PER_MINUTE_OF_AUDIO) / 1024;

  const transcriptionCents = provider.estimateCostCents(durationMs);
  const summarizationCents = minutes * SUMMARIZATION_CENTS_PER_MINUTE;
  const storageCents = approxGb * STORAGE_CENTS_PER_GB_MONTH;
  const bandwidthCents = approxGb * BANDWIDTH_CENTS_PER_GB * 2; // one upload + one download for review

  return {
    transcriptionCents,
    summarizationCents,
    storageCents,
    bandwidthCents,
    totalCents: transcriptionCents + summarizationCents + storageCents + bandwidthCents,
  };
}

export interface MonthlyCostEstimateCents extends MeetingCostBreakdownCents {
  meetingsPerMonth: number;
  avgDurationMinutes: number;
}

export function estimateMonthlyCostCents(
  meetingsPerMonth: number,
  avgDurationMinutes: number,
  providerId: ProviderId
): MonthlyCostEstimateCents {
  const perMeeting = estimateMeetingCostCents(avgDurationMinutes * 60_000, providerId);
  return {
    meetingsPerMonth,
    avgDurationMinutes,
    transcriptionCents: perMeeting.transcriptionCents * meetingsPerMonth,
    summarizationCents: perMeeting.summarizationCents * meetingsPerMonth,
    storageCents: perMeeting.storageCents * meetingsPerMonth,
    bandwidthCents: perMeeting.bandwidthCents * meetingsPerMonth,
    totalCents: perMeeting.totalCents * meetingsPerMonth,
  };
}

export function centsToDollarsDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
