/**
 * Meeting Intelligence Technical Spike — provider abstraction.
 *
 * This interface is the entire point of the provider-evaluation phase: no
 * route, worker, or UI in this spike (or in a real future implementation)
 * should ever import an OpenAI or AssemblyAI SDK directly. Everything talks
 * to `MeetingTranscriptionProvider`, so swapping providers — or running
 * both side by side for a quality comparison — never requires touching
 * calling code. See docs/meeting-intelligence-spike.md for the comparison
 * that led to the recommended default.
 */

export interface TranscriptSegment {
  /** "Speaker A", "Speaker B", ... — see speaker-labeling.ts. Never a real identity at this stage. */
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
  /** 0–1, provider-reported confidence for this segment. */
  confidence: number;
}

export interface TranscriptResult {
  provider: string;
  language: string;
  durationMs: number;
  segments: TranscriptSegment[];
  fullText: string;
  /** Provider-specific raw response, kept opaque and untyped deliberately — callers must go through the normalized fields above, never reach into a provider's native shape. */
  raw?: unknown;
}

export interface TranscriptionRequest {
  /** A signed, time-limited URL to the uploaded recording — never raw audio bytes in this interface, and never a permanent public URL. See storage architecture in docs/meeting-intelligence-spike.md. */
  audioUrl: string;
  languageHint?: string;
  expectedSpeakerCount?: number;
  organizationId: string;
  meetingId: string;
}

export type EnterpriseReadiness = "low" | "medium" | "high";

export interface ProviderCapabilities {
  /** Whether the provider natively separates speakers, vs. requiring a separate diarization pass. */
  speakerDiarization: boolean;
  supportedFormats: string[];
  webhookSupport: boolean;
  maxFileSizeMb: number;
  /** Multiplier of audio duration a typical job takes to process — 0.2 means a 60-minute recording finishes processing in about 12 minutes. Illustrative, not a live SLA. */
  averageProcessingSpeedRatio: number;
  enterpriseReadiness: EnterpriseReadiness;
  /** Free-text notes on privacy posture (e.g. zero-retention options, certifications) — see docs/meeting-intelligence-spike.md for sourcing. */
  privacyControls: string[];
}

export interface MeetingTranscriptionProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;
  transcribe(request: TranscriptionRequest): Promise<TranscriptResult>;
  /** Rough estimate only — see cost-model.ts for the full estimation surface used by the spike's cost pages. */
  estimateCostCents(durationMs: number): number;
}
