import { withApiErrorHandling } from "@/lib/api-route";
import { requireConcernAccess } from "@/lib/labs/pta/guard";
import { createConcern, listConcerns } from "@/lib/labs/pta/concerns";
import { parseJsonBody, z } from "@/lib/validation";

/** GET /api/labs/pta/concerns — cases readable by this viewer, plus redacted
 * stubs of restricted cases (assign-permission holders only). The lib does
 * the per-case filtering; this route never widens it. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId, viewer } = await requireConcernAccess();
    const data = await listConcerns(organizationId, viewer);
    return Response.json({ ok: true, data });
  });
}

const CONCERN_CATEGORIES = [
  "BYLAWS_CONCERN",
  "OFFICER_CONDUCT",
  "MEMBER_CONDUCT",
  "ELECTION_CONCERN",
  "FINANCIAL_CONCERN",
  "VOLUNTEER_CONCERN",
  "EVENT_ISSUE",
  "POLICY_VIOLATION",
  "CONFLICT_OF_INTEREST",
  "MEMBERSHIP_DISPUTE",
  "OTHER",
] as const;

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(20000),
  category: z.enum(CONCERN_CATEGORIES).optional(),
  isRestricted: z.boolean().optional(),
  reporterName: z.string().max(200).nullable().optional(),
  reporterContact: z.string().max(300).nullable().optional(),
  subjectName: z.string().max(200).nullable().optional(),
  incidentDate: z.coerce.date().nullable().optional(),
  responseDeadline: z.coerce.date().nullable().optional(),
  assignedCommitteeId: z.string().max(64).nullable().optional(),
  applicableGovernanceDocumentId: z.string().max(64).nullable().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, viewer } = await requireConcernAccess();
    if (!viewer.canManage) {
      return Response.json({ ok: false, error: "Recording a case requires the manage permission." }, { status: 403 });
    }
    const input = await parseJsonBody(request, createSchema);
    const concern = await createConcern({ organizationId, ...input, actor: viewer });
    return Response.json({ ok: true, data: concern }, { status: 201 });
  });
}
