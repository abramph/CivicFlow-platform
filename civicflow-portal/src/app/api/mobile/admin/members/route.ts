import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { resolveMobileAdminCapabilities } from "@/lib/mobile-admin";
import { prisma } from "@/lib/prisma";
import { ValidationError, parseJsonBody, z } from "@/lib/validation";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseMemberFilters, buildMemberWhere, buildMemberOrderBy } from "@/lib/member-filters";
import { createMember, createMemberSchema } from "@/lib/member-mutations";

const createMobileMemberSchema = createMemberSchema.extend({ organizationId: z.string().min(1) });

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function resolvePageSize(raw: string | null) {
  const parsed = Number(raw);
  if (!raw || Number.isNaN(parsed)) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(Math.trunc(parsed), MAX_PAGE_SIZE));
}

function resolvePage(raw: string | null) {
  const parsed = Number(raw);
  if (!raw || Number.isNaN(parsed) || parsed < 1) return 1;
  return Math.trunc(parsed);
}

/**
 * GET /api/mobile/admin/members?organizationId=...&search=...&membershipStatus=...&page=...&pageSize=...
 *
 * Mobile Admin program (PR B) — member list. Reuses the same
 * parseMemberFilters/buildMemberWhere/buildMemberOrderBy the web /members
 * page and export route use (src/lib/member-filters.ts), so search/filter/
 * sort semantics can never drift between web and mobile. Gated the same way
 * every other admin capability is: Labs enrollment + manageMembers, which
 * is unavailable for PTA orgs (they don't use OrgMember as their roster —
 * see src/lib/mobile-admin.ts's FLAG_RULES doc comment).
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { userId } = await requireMobileAuth(request);
    const admin = await resolveMobileAdminCapabilities(organizationId, userId);
    if (!admin.available || !admin.adminCapabilities.includes("manageMembers")) {
      throw new MobileForbiddenError("No mobile member administration access for this organization");
    }

    const filters = parseMemberFilters(searchParams);
    const where = buildMemberWhere(organizationId, filters);
    const orderBy = buildMemberOrderBy(filters.sort);

    const pageSize = resolvePageSize(searchParams.get("pageSize"));
    const page = resolvePage(searchParams.get("page"));

    const [total, rows] = await Promise.all([
      prisma.orgMember.count({ where }),
      prisma.orgMember.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          email: true,
          phone: true,
          membershipStatus: true,
          isDelinquent: true,
          householdName: true,
          city: true,
          state: true,
        },
      }),
    ]);

    return Response.json({
      ok: true,
      data: { members: rows, page, pageSize, total, hasMore: page * pageSize < total },
    });
  });
}

/**
 * POST /api/mobile/admin/members
 * Body: { organizationId, ...createMemberSchema fields }
 * Delegates to the exact same createMember() the web /members/new form
 * uses (src/lib/member-mutations.ts) — no separate mobile-only write path,
 * same plan-gate/validation/audit/timeline behavior.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:members:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, ...input } = await parseJsonBody(request, createMobileMemberSchema);

    const { userId, email } = await requireMobileAuth(request);
    const admin = await resolveMobileAdminCapabilities(organizationId, userId);
    if (!admin.available || !admin.adminCapabilities.includes("manageMembers")) {
      throw new MobileForbiddenError("No mobile member administration access for this organization");
    }

    const result = await createMember(organizationId, { userId, userEmail: email }, input);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data }, { status: 201 });
  });
}
