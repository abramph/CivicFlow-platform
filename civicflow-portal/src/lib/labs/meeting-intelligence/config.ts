import { MeetingIntelligenceError } from "./errors";
// Type-only import — erased at compile time, so this does not create a
// runtime circular dependency even though providers/assemblyai-adapter.ts
// (reachable from providers/async-index.ts) imports requireAssemblyAiApiKey
// from this file.
import type { MeetingIntelligenceProviderId } from "./providers/async-index";

/**
 * Single, centralized, validated read of Meeting Intelligence's env-configured
 * settings (ASSEMBLYAI_API_KEY, OPENAI_API_KEY, MEETING_INTELLIGENCE_PROVIDER).
 * These are deliberately NOT added to src/lib/env.ts's serverEnvSchema — see
 * that file's comment — because they must not block app-wide boot when unset;
 * the whole app (and every other Labs feature) must be able to start with
 * Meeting Intelligence disabled. This module is the one place that reads
 * process.env for them, so every call site gets identical validation instead
 * of re-implementing its own ad hoc process.env access:
 *   - an explicitly-set but unrecognized MEETING_INTELLIGENCE_PROVIDER value
 *     fails clearly and immediately, rather than silently falling back;
 *   - a missing ASSEMBLYAI_API_KEY fails with a stable, non-retryable code
 *     distinct from a transient vendor outage;
 *   - none of these values are ever logged, and they never appear in a
 *     MeetingIntelligenceError message (only the fact that they're missing).
 */

// Mirrors providers/async-index.ts's PROVIDERS registry keys. Duplicated as a
// plain literal (rather than importing the registry) specifically to avoid a
// runtime circular import — see the import comment above. Covered by
// config.test.ts's "every known provider id resolves a real provider" test,
// which fails loudly if the two ever drift apart.
const KNOWN_PROVIDER_IDS: readonly MeetingIntelligenceProviderId[] = ["assemblyai"];

function isKnownMeetingIntelligenceProviderId(id: string): id is MeetingIntelligenceProviderId {
  return (KNOWN_PROVIDER_IDS as readonly string[]).includes(id);
}

/**
 * Defaults to "assemblyai" when unset. Throws MEETING_INTELLIGENCE_PROVIDER_MISCONFIGURED
 * for any explicitly-set but unrecognized value — an operator typo must never
 * silently resolve to a different provider than the one they intended to configure.
 */
export function resolveMeetingIntelligenceProviderId(): MeetingIntelligenceProviderId {
  const configured = process.env.MEETING_INTELLIGENCE_PROVIDER;
  if (!configured) return "assemblyai";
  if (isKnownMeetingIntelligenceProviderId(configured)) return configured;
  throw new MeetingIntelligenceError(
    "MEETING_INTELLIGENCE_PROVIDER_MISCONFIGURED",
    `MEETING_INTELLIGENCE_PROVIDER is set to an unrecognized value. Valid values: ${KNOWN_PROVIDER_IDS.join(", ")}.`
  );
}

/**
 * Throws MEETING_INTELLIGENCE_PROVIDER_MISCONFIGURED (non-retryable) rather
 * than PROVIDER_UNAVAILABLE (retryable) when unset — a retry can never
 * succeed until an operator sets the env var, so the job-detail page's
 * "Retry" affordance (driven by MeetingIntelligenceError.retryable) must
 * never be offered for this failure.
 */
export function requireAssemblyAiApiKey(): string {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) {
    throw new MeetingIntelligenceError(
      "MEETING_INTELLIGENCE_PROVIDER_MISCONFIGURED",
      "ASSEMBLYAI_API_KEY is not configured. Meeting Intelligence transcription is unavailable until an APH platform operator configures it."
    );
  }
  return key;
}

/** Optional — callers fall back to the deterministic generator when undefined. */
export function getOpenAiApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY || undefined;
}
