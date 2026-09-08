import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { PERMISSIONS } from "@/lib/rbac";
import {
  getProgressionPublicationStatus,
  publishProgressionResults,
  unpublishProgressionResults,
} from "@/lib/labs/pta/progression-publication";
import { parseJsonBody, z } from "@/lib/validation";

/**
 * Publication (disclosure-to-families) control for one progression batch.
 * Portal-only: there is no mobile counterpart, and the mobile app can only
 * ever read the published *result*, never change publication state.
 *
 * Authorization runs before the request body is parsed on every verb, via
 * requirePtaAccess (tenant RBAC permission + PTA vertical + active org);
 * the service then enforces both progression feature flags. The
 * organizationId always comes from the server-resolved session, never from
 * the client.
 */

const publishSchema = z.object({
  /** The publicationVersion the caller last saw — optimistic concurrency. */
  publicationVersion: z.number().int().min(0),
  /** Makes a retried publish a safe no-op instead of a second disclosure. */
  idempotencyKey: z.string().min(1).max(200),
});

const unpublishSchema = z.object({
  publicationVersion: z.number().int().min(0),
});

/** GET — publication status plus a publishability assessment (eligible,
 * excluded and blocking counts, and why publication is blocked). Uses the
 * lower PREVIEW permission: seeing whether results are published is part of
 * ordinary progression review. */
export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess(PERMISSIONS.PTA_STUDENT_PROGRESSION_PREVIEW);
    const { batchId } = await params;
    const data = await getProgressionPublicationStatus(organizationId, batchId);
    return Response.json({ ok: true, data });
  });
}

/** POST — publish committed results to families. High-risk, irreversible
 * disclosure: requires the dedicated PUBLISH permission (ORG_ADMIN/
 * ORG_OWNER), not merely COMMIT. */
export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess(PERMISSIONS.PTA_STUDENT_PROGRESSION_PUBLISH);
    const { batchId } = await params;
    const input = await parseJsonBody(request, publishSchema);
    const data = await publishProgressionResults({
      organizationId,
      batchId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data });
  });
}

/** DELETE — withdraw previously published results from family view. Hides
 * them from future reads; does NOT undo the disclosure that already
 * happened (the state becomes WITHDRAWN, not UNPUBLISHED). Same elevated
 * permission as publishing. */
export async function DELETE(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess(PERMISSIONS.PTA_STUDENT_PROGRESSION_PUBLISH);
    const { batchId } = await params;
    const input = await parseJsonBody(request, unpublishSchema);
    const data = await unpublishProgressionResults({
      organizationId,
      batchId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data });
  });
}
