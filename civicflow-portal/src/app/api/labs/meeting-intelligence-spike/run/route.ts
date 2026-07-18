import { randomUUID } from "crypto";
import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireOrganizationLabFeature } from "@/lib/labs/access";
import { runMeetingIntelligenceSpikePipeline } from "@/lib/labs/meeting-intelligence/pipeline";
import { recordMeetingIntelligenceUsage } from "@/lib/labs/meeting-intelligence/usage";
import { validateMeetingIntelligenceSubmission } from "@/lib/labs/meeting-intelligence/privacy";

/**
 * Runs the full spike pipeline against synthetic fixture audio and records
 * one usage event. No real audio is uploaded or fetched, no external API
 * call is made (the provider adapters are local mocks), and nothing is
 * persisted — this proves the pipeline + Labs gating + usage-metering
 * chain works end to end without building a real job queue or database
 * model for this spike.
 */
export async function POST() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("labs:read", "throw");
    await requireOrganizationLabFeature(organizationId, "meetingIntelligence");

    const privacyCheck = validateMeetingIntelligenceSubmission({
      explicitUserTriggered: true, // this endpoint is only ever reached by an explicit button click
      recordingNoticeAcknowledged: true, // synthetic fixture meeting — no real participants to notice
      organizationOwnershipConfirmed: true, // synthetic fixture content, owned by no one
    });
    if (!privacyCheck.allowed) {
      return Response.json({ ok: false, error: privacyCheck.reason }, { status: 400 });
    }

    const meetingId = `spike-run-${randomUUID()}`;
    const result = await runMeetingIntelligenceSpikePipeline({
      organizationId,
      meetingId,
      meetingTitle: "Synthetic Spike Meeting",
      audioUrl: `synthetic://${meetingId}`,
      attendees: [
        { id: "fixture-1", name: "Alex Chair" },
        { id: "fixture-2", name: "Bailey Secretary" },
      ],
      agenda: ["Call to order", "Old business", "New business", "Adjournment"],
    });

    await recordMeetingIntelligenceUsage({
      organizationId,
      providerId: result.providerId,
      durationMs: result.transcript.durationMs,
      processingMs: result.processingMs,
      estimatedCostCents: result.costCents.totalCents,
    });

    return Response.json({ ok: true, data: result });
  });
}
