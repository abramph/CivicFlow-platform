import { recordLabUsage } from "@/lib/labs/usage";
import type { ProviderId } from "./providers";

/**
 * Meeting Intelligence Technical Spike — usage metering prototype.
 *
 * A thin, feature-specific wrapper over the generic Labs usage-metering
 * interface (`src/lib/labs/usage.ts`, built in the Labs foundation PR) —
 * proves that a real capability composes the generic interface rather than
 * inventing its own tracking. Not connected to Stripe; no charge, no
 * invoice, no Stripe product/price is created anywhere in this call chain.
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
