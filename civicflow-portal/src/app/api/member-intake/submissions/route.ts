import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberIntakeView } from "@/lib/member-intake/forms";
import { listSubmissions, type SubmissionQueueFilter } from "@/lib/member-intake/review";

const VALID_FILTERS: SubmissionQueueFilter[] = ["ALL", "NEEDS_VERIFICATION", "NEEDS_REVIEW", "POSSIBLE_DUPLICATES", "NEW_MEMBERS", "UPDATES", "REJECTED"];

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireMemberIntakeView();
    const url = new URL(request.url);
    const formId = url.searchParams.get("formId") ?? undefined;
    const cursor = url.searchParams.get("cursor");
    const filterParam = url.searchParams.get("filter");
    const filter = filterParam && VALID_FILTERS.includes(filterParam as SubmissionQueueFilter) ? (filterParam as SubmissionQueueFilter) : "ALL";

    const result = await listSubmissions(organizationId, { formId, filter, cursor });
    return Response.json({ ok: true, data: result });
  });
}
