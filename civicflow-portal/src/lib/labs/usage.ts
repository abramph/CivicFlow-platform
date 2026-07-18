import { prisma } from "@/lib/prisma";
import { isLabFeatureKey, type LabFeatureKey } from "./registry";

/**
 * Reserved unit vocabulary for future Labs usage metering — not wired to
 * Stripe, not billed, not invoiced. Extend this list when a real metered
 * capability ships; app-level (not a DB enum) so adding a unit never needs
 * a migration.
 */
export const LAB_USAGE_UNITS = [
  "audio_minutes",
  "meetings_processed",
  "ai_tokens",
  "documents_analyzed",
  "reports_generated",
  "automation_executions",
] as const;

export type LabUsageUnit = (typeof LAB_USAGE_UNITS)[number];

/**
 * Metadata may only ever hold identifiers and counts — a flat record of
 * primitives, never a nested object/array. This is a deliberate structural
 * constraint (not just a comment) so a future caller can't accidentally
 * pass a transcript, prompt, or recording payload through this field:
 * doing so wouldn't even type-check.
 */
export type LabUsageMetadata = Record<string, string | number | boolean | null>;

export interface RecordLabUsageInput {
  organizationId: string;
  featureKey: LabFeatureKey;
  unit: LabUsageUnit;
  quantity: number;
  metadata?: LabUsageMetadata;
}

/**
 * The sole write path for Labs usage metering — append-only (no update or
 * delete is exposed anywhere), not connected to Stripe metered billing, and
 * never used to charge a customer or create an invoice. Exists so future
 * Labs features have one real, typed place to record usage against from
 * day one, rather than each feature inventing its own ad hoc tracking.
 */
export async function recordLabUsage(input: RecordLabUsageInput): Promise<void> {
  if (!isLabFeatureKey(input.featureKey)) {
    throw new Error(`recordLabUsage: unknown Labs feature key: ${input.featureKey}`);
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("recordLabUsage: quantity must be a positive, finite number");
  }

  await prisma.labUsageEvent.create({
    data: {
      organizationId: input.organizationId,
      featureKey: input.featureKey,
      unit: input.unit,
      quantity: input.quantity,
      metadata: input.metadata ?? undefined,
    },
  });
}
