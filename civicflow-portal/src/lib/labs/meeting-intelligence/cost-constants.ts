/**
 * Meeting Intelligence MVP — isolated vendor-pricing constants.
 *
 * These are illustrative approximations based on each vendor's publicly
 * documented rate card at the time of writing — NOT a live quote, NOT a
 * contractual commitment, and NOT connected to Stripe or any customer
 * charge. Kept in one place, clearly labeled, specifically so they are
 * easy to find and update when a vendor's pricing changes — review
 * periodically, do not treat as permanent.
 */

export const ASSEMBLYAI_CENTS_PER_MINUTE = 0.45;

export const OPENAI_MINUTES_GENERATION_CENTS_PER_MEETING = 2; // illustrative flat estimate per structured-minutes generation call

export function estimateTranscriptionCostCents(durationMinutes: number): number {
  return durationMinutes * ASSEMBLYAI_CENTS_PER_MINUTE;
}

export function estimateGenerationCostCents(): number {
  return OPENAI_MINUTES_GENERATION_CENTS_PER_MEETING;
}
