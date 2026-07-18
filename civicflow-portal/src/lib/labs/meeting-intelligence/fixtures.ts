import type { MeetingJobStage } from "./workflow";

/**
 * Synthetic "Recent Jobs" fixture data for the UI mock screens — nothing
 * here is persisted or backed by a database table. Running the spike's
 * "run a synthetic job" action does not add to this list; it demonstrates
 * the pipeline in isolation. A production implementation would replace
 * this with a real MeetingIntelligenceJob table queried per organization.
 */
export interface MockJobSummary {
  jobId: string;
  meetingTitle: string;
  stage: MeetingJobStage;
  providerId: "openai" | "assemblyai";
  durationMinutes: number;
  createdAt: string;
}

export const MOCK_RECENT_JOBS: MockJobSummary[] = [
  { jobId: "spike-job-1", meetingTitle: "Monthly Board Meeting", stage: "ARCHIVED", providerId: "assemblyai", durationMinutes: 52, createdAt: "2026-07-01T18:00:00Z" },
  { jobId: "spike-job-2", meetingTitle: "Finance Committee", stage: "IN_REVIEW", providerId: "assemblyai", durationMinutes: 28, createdAt: "2026-07-10T17:00:00Z" },
  { jobId: "spike-job-3", meetingTitle: "Executive Session", stage: "AI_PROCESSING", providerId: "openai", durationMinutes: 41, createdAt: "2026-07-15T20:00:00Z" },
  { jobId: "spike-job-4", meetingTitle: "Annual General Meeting", stage: "FAILED", providerId: "openai", durationMinutes: 75, createdAt: "2026-07-17T16:00:00Z" },
];

export function findMockJob(jobId: string): MockJobSummary | undefined {
  return MOCK_RECENT_JOBS.find((job) => job.jobId === jobId);
}
