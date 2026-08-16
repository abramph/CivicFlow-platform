import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MEMBER-QR-B — API route tests for the admin form-builder surface.
 * Guards (requireMemberIntakeView/Manage/Publish) are mocked directly
 * rather than mocking auth-guards+labs/access separately, since the routes
 * import those guard functions straight from forms.ts alongside the real
 * CRUD functions -- prisma itself stays mocked so the real forms.ts logic
 * (target-field allow-list, status state machine, org-scoped lookups) still
 * runs and is what these tests actually exercise.
 */

const ACTOR = { organizationId: "org-a", session: { userId: "staff-1", userEmail: "staff@org-a.example.com" }, role: "ORG_ADMIN" as const };

vi.mock("@/lib/member-intake/forms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/member-intake/forms")>();
  return {
    ...actual,
    requireMemberIntakeView: vi.fn().mockResolvedValue(ACTOR),
    requireMemberIntakeManage: vi.fn().mockResolvedValue(ACTOR),
    requireMemberIntakePublish: vi.fn().mockResolvedValue(ACTOR),
  };
});
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ NEXTAUTH_URL: "https://app.test.example" }) }));

const findFirstForm = vi.fn();
const findUniqueForm = vi.fn();
const updateForm = vi.fn();
const createForm = vi.fn();
const findManyForm = vi.fn();
const findUniqueField = vi.fn();
const createField = vi.fn();
const deleteField = vi.fn();
const findFirstField = vi.fn();
const countFields = vi.fn();
const createSource = vi.fn();
const findFirstSource = vi.fn();
const updateSource = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    memberIntakeForm: {
      findFirst: (...a: unknown[]) => findFirstForm(...a),
      findUnique: (...a: unknown[]) => findUniqueForm(...a),
      update: (...a: unknown[]) => updateForm(...a),
      create: (...a: unknown[]) => createForm(...a),
      findMany: (...a: unknown[]) => findManyForm(...a),
    },
    memberIntakeFormField: {
      findUnique: (...a: unknown[]) => findUniqueField(...a),
      create: (...a: unknown[]) => createField(...a),
      delete: (...a: unknown[]) => deleteField(...a),
      findFirst: (...a: unknown[]) => findFirstField(...a),
      count: (...a: unknown[]) => countFields(...a),
    },
    memberIntakeFormSource: {
      create: (...a: unknown[]) => createSource(...a),
      findFirst: (...a: unknown[]) => findFirstSource(...a),
      update: (...a: unknown[]) => updateSource(...a),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  createForm.mockImplementation((args: { data: Record<string, unknown> }) => ({ id: "form-1", ...args.data }));
  updateForm.mockImplementation((args: { data: Record<string, unknown> }) => ({ id: "form-1", ...args.data }));
  createField.mockImplementation((args: { data: Record<string, unknown> }) => ({ id: "field-1", ...args.data }));
  findUniqueField.mockResolvedValue(null);
});

function jsonRequest(url: string, method: string, body?: Record<string, unknown>) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("POST /api/member-intake/forms", () => {
  it("creates a form scoped to the caller's organization", async () => {
    const { POST } = await import("@/app/api/member-intake/forms/route");
    const response = await POST(jsonRequest("https://app.test/api/member-intake/forms", "POST", { name: "Fall Drive", purpose: "NEW_OR_UPDATE", title: "Join Us" }));
    expect(response.status).toBe(201);
    expect(createForm).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-a" }) }));
  });

  it("rejects an invalid purpose", async () => {
    const { POST } = await import("@/app/api/member-intake/forms/route");
    const response = await POST(jsonRequest("https://app.test/api/member-intake/forms", "POST", { name: "X", purpose: "NOT_REAL", title: "X" }));
    expect(response.status).toBe(400);
    expect(createForm).not.toHaveBeenCalled();
  });
});

describe("GET/PATCH /api/member-intake/forms/[id] — tenant isolation", () => {
  it("returns 404 for a form belonging to a different organization", async () => {
    findFirstForm.mockResolvedValue(null); // org-scoped WHERE clause simulated as "not found"
    const { GET } = await import("@/app/api/member-intake/forms/[id]/route");
    const response = await GET(jsonRequest("https://app.test/api/member-intake/forms/form-x", "GET"), { params: Promise.resolve({ id: "form-x" }) });
    expect(response.status).toBe(404);
  });

  it("includes a publicUrl built from the form's own publicToken", async () => {
    findFirstForm.mockResolvedValue({ id: "form-1", organizationId: "org-a", publicToken: "tok-abc", fields: [], sources: [] });
    const { GET } = await import("@/app/api/member-intake/forms/[id]/route");
    const response = await GET(jsonRequest("https://app.test/api/member-intake/forms/form-1", "GET"), { params: Promise.resolve({ id: "form-1" }) });
    const body = await response.json();
    expect(body.data.publicUrl).toBe("https://app.test.example/f/tok-abc");
  });

  it("PATCH 404s rather than updating a form from a different organization", async () => {
    findFirstForm.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/member-intake/forms/[id]/route");
    const response = await PATCH(jsonRequest("https://app.test/api/member-intake/forms/form-x", "PATCH", { title: "Hijacked" }), {
      params: Promise.resolve({ id: "form-x" }),
    });
    expect(response.status).toBe(404);
    expect(updateForm).not.toHaveBeenCalled();
  });
});

describe("POST /api/member-intake/forms/[id]/status", () => {
  it("rejects an illegal lifecycle transition with the mapped status code", async () => {
    findFirstForm.mockResolvedValue({ id: "form-1", organizationId: "org-a", status: "ARCHIVED" });
    const { POST } = await import("@/app/api/member-intake/forms/[id]/status/route");
    const response = await POST(jsonRequest("https://app.test/api/member-intake/forms/form-1/status", "POST", { action: "resume" }), {
      params: Promise.resolve({ id: "form-1" }),
    });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.code).toBe("MEMBER_INTAKE_INVALID_STATUS_TRANSITION");
    expect(updateForm).not.toHaveBeenCalled();
  });

  it("rejects publishing a form with zero fields", async () => {
    countFields.mockResolvedValue(0);
    const { POST } = await import("@/app/api/member-intake/forms/[id]/status/route");
    const response = await POST(jsonRequest("https://app.test/api/member-intake/forms/form-1/status", "POST", { action: "publish" }), {
      params: Promise.resolve({ id: "form-1" }),
    });
    expect(response.status).toBe(400);
    expect(updateForm).not.toHaveBeenCalled();
  });

  it("publishes a DRAFT form with at least one field", async () => {
    countFields.mockResolvedValue(1);
    findFirstForm.mockResolvedValue({ id: "form-1", organizationId: "org-a", status: "DRAFT" });
    const { POST } = await import("@/app/api/member-intake/forms/[id]/status/route");
    const response = await POST(jsonRequest("https://app.test/api/member-intake/forms/form-1/status", "POST", { action: "publish" }), {
      params: Promise.resolve({ id: "form-1" }),
    });
    expect(response.status).toBe(200);
    expect(updateForm).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ACTIVE" }) }));
  });

  it("rejects an unrecognized action before touching the database", async () => {
    const { POST } = await import("@/app/api/member-intake/forms/[id]/status/route");
    const response = await POST(jsonRequest("https://app.test/api/member-intake/forms/form-1/status", "POST", { action: "delete-everything" }), {
      params: Promise.resolve({ id: "form-1" }),
    });
    expect(response.status).toBe(400);
    expect(findFirstForm).not.toHaveBeenCalled();
  });
});

describe("POST /api/member-intake/forms/[id]/fields — target-field allow-list", () => {
  beforeEach(() => {
    findFirstForm.mockResolvedValue({ id: "form-1", organizationId: "org-a" });
  });

  it("rejects a targetField not on the server-side allow-list, even through the real API route", async () => {
    const { POST } = await import("@/app/api/member-intake/forms/[id]/fields/route");
    const response = await POST(
      jsonRequest("https://app.test/api/member-intake/forms/form-1/fields", "POST", {
        fieldKey: "role",
        label: "Role",
        fieldType: "TEXT",
        targetEntity: "MEMBER",
        targetField: "membershipCategoryId",
      }),
      { params: Promise.resolve({ id: "form-1" }) }
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe("MEMBER_INTAKE_INVALID_TARGET_FIELD");
    expect(createField).not.toHaveBeenCalled();
  });

  it("rejects a fieldKey that doesn't match the safe identifier pattern", async () => {
    const { POST } = await import("@/app/api/member-intake/forms/[id]/fields/route");
    const response = await POST(
      jsonRequest("https://app.test/api/member-intake/forms/form-1/fields", "POST", {
        fieldKey: "not a valid key!",
        label: "X",
        fieldType: "TEXT",
        targetEntity: "CUSTOM",
      }),
      { params: Promise.resolve({ id: "form-1" }) }
    );
    expect(response.status).toBe(400);
    expect(createField).not.toHaveBeenCalled();
  });

  it("accepts a valid MEMBER-targeted field", async () => {
    const { POST } = await import("@/app/api/member-intake/forms/[id]/fields/route");
    const response = await POST(
      jsonRequest("https://app.test/api/member-intake/forms/form-1/fields", "POST", {
        fieldKey: "email",
        label: "Email",
        fieldType: "EMAIL",
        targetEntity: "MEMBER",
        targetField: "email",
      }),
      { params: Promise.resolve({ id: "form-1" }) }
    );
    expect(response.status).toBe(201);
    expect(createField).toHaveBeenCalled();
  });
});

describe("GET /api/member-intake/forms/[id]/qr", () => {
  it("404s a form belonging to a different organization rather than generating a QR code", async () => {
    findFirstForm.mockResolvedValue(null);
    const { GET } = await import("@/app/api/member-intake/forms/[id]/qr/route");
    const response = await GET(jsonRequest("https://app.test/api/member-intake/forms/form-x/qr", "GET"), { params: Promise.resolve({ id: "form-x" }) });
    expect(response.status).toBe(404);
  });

  it("rejects a sourceId that doesn't belong to this form", async () => {
    findFirstForm.mockResolvedValue({ publicToken: "tok-abc" });
    findFirstSource.mockResolvedValue(null);
    const { GET } = await import("@/app/api/member-intake/forms/[id]/qr/route");
    const response = await GET(jsonRequest("https://app.test/api/member-intake/forms/form-1/qr?sourceId=foreign-source", "GET"), {
      params: Promise.resolve({ id: "form-1" }),
    });
    expect(response.status).toBe(404);
  });

  it("embeds the source token (not the source id) in the generated URL", async () => {
    findFirstForm.mockResolvedValue({ publicToken: "tok-abc" });
    findFirstSource.mockResolvedValue({ token: "src-token-xyz" });
    const { GET } = await import("@/app/api/member-intake/forms/[id]/qr/route");
    const response = await GET(jsonRequest("https://app.test/api/member-intake/forms/form-1/qr?sourceId=source-1", "GET"), {
      params: Promise.resolve({ id: "form-1" }),
    });
    const body = await response.json();
    expect(body.data.publicUrl).toBe("https://app.test.example/f/tok-abc?src=src-token-xyz");
    expect(body.data.publicUrl).not.toContain("source-1");
  });
});
