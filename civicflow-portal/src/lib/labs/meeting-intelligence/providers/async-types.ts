/**
 * Meeting Intelligence MVP — the production, asynchronous provider
 * interface. Distinct from the synchronous `MeetingTranscriptionProvider`
 * in ./types.ts (the technical spike's mock interface, kept unchanged as
 * historical documentation) — the MVP submits a job and polls for status,
 * matching how a real vendor (AssemblyAI) actually works, rather than the
 * spike's "await one call and get a full transcript back" mock shape.
 *
 * No route handler, worker, or UI component may depend on an
 * AssemblyAI-specific type — everything is expressed in terms of the
 * interface below.
 */

export type TranscriptSegment = {
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
};

export interface TranscriptionRequest {
  organizationId: string;
  jobId: string;
  meetingId: string;
  /** A short-lived signed URL to the uploaded recording — never a permanent public URL, never raw audio bytes in this interface. */
  audioUrl: string;
  languageHint?: string;
  expectedSpeakerCount?: number;
}

export interface TranscriptionSubmission {
  externalJobId: string;
  status: "queued" | "processing";
}

export interface TranscriptionResult {
  language: string;
  durationMs: number;
  fullText: string;
  segments: TranscriptSegment[];
  speakerCount: number;
}

export interface TranscriptionStatus {
  status: "queued" | "processing" | "completed" | "error";
  errorMessage?: string;
  result?: TranscriptionResult;
}

export interface MeetingTranscriptionProvider {
  readonly id: string;
  readonly displayName: string;
  submit(request: TranscriptionRequest): Promise<TranscriptionSubmission>;
  getStatus(externalJobId: string): Promise<TranscriptionStatus>;
  cancel?(externalJobId: string): Promise<void>;
}
