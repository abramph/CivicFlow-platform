import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * MEMBER-QR-A — forms.ts. Covers the field-targeting allow-list enforcement
 * (the ONE place §16/§25/§40's "never trust target field mappings from
 * browser" rule is enforced), the lifecycle state machine, publish
 * requiring at least one field, token regeneration, and
 * resolvePublicIntakeForm's no-enumeration discipline (every failure mode
 * collapses to the same null).
 */

const findFirstForm = vi.fn();
const findUniqueForm = vi.fn();
const updateForm = vi.fn();
const createForm = vi.fn();
const findUniqueField = vi.fn();
const createField = vi.fn();
const countFields = vi.fn();
const findFirstSource = vi.fn();
const createAuditEvent = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    memberIntakeForm: {
      findFirst: (...a: unknown[]) => findFirstForm(...a),
      findUnique: (...a: unknown[]) => findUniqueForm(...a),
      update: (...a: unknown[]) => updateForm(...a),
      create: (...a: unknown[]) => createForm(...a),
    },
    memberIntakeFormField: {
      findUnique: (...a: unknown[]) => findUniqueField(...a),
      create: (...a: unknown[]) => createField(...a),
      count: (...a: unknown[]) => countFields(...a),
    },
    memberIntakeFormSource: {
      findFirst: (...a: unknown[]) => findFirstSource(...a),
    },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));
vi.mock("@/lib/auth-guards", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/labs/access", () => ({ requireOrganizationLabFeature: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  createField.mockImplementation((args: { data: Record<string, unknown> }) => ({ id: "field-1", ...args.data }));
});

describe("createFormField — target field allow-list enforcement", () => {
  it("rejects a targetField that isn't on the allow-list", async () => {
    findFirstForm.mockResolvedValue({ id: "form-1", organizationId: "org-a" });
    findUniqueField.mockResolvedValue(null);
    const { createFormField } = await import("../forms");
    await expect(
      createFormField("org-a", "form-1", "user-1", {
        fieldKey: "role",
        label: "Role",
        fieldType: "TEXT",
        targetEntity: "MEMBER",
        targetField: "membershipCategoryId", // permissions-adjacent, not on the allow-list
      })
    ).rejects.toMatchObject({ code: "MEMBER_INTAKE_INVALID_TARGET_FIELD" });
    expect(createField).not.toHaveBeenCalled();
  });

  it("rejects a tampered targetField naming an RBAC/internal-plumbing column", async () => {
    findFirstForm.mockResolvedValue({ id: "form-1", organizationId: "org-a" });
    findUniqueField.mockResolvedValue(null);
    const { createFormField } = await import("../forms");
    await expect(
      createFormField("org-a", "form-1", "user-1", {
        fieldKey: "x",
        label: "X",
        fieldType: "TEXT",
        targetEntity: "MEMBER",
        targetField: "organizationId",
      })
    ).rejects.toMatchObject({ code: "MEMBER_INTAKE_INVALID_TARGET_FIELD" });
  });

  it("accepts a CUSTOM field with no targetField at all", async () => {
    findFirstForm.mockResolvedValue({ id: "form-1", organizationId: "org-a" });
    findUniqueField.mockResolvedValue(null);
    const { createFormField } = await import("../forms");
    const field = await createFormField("org-a", "form-1", "user-1", {
      fieldKey: "shirtSize",
      label: "T-shirt size",
      fieldType: "SELECT",
      options: ["S", "M", "L"],
      targetEntity: "CUSTOM",
    });
    expect(field.targetField).toBeNull();
    expect(field.isCustomField).toBe(true);
  });

  it("never allows a configured sensitivity to be less restrictive than the column's own floor", async () => {
    findFirstForm.mockResolvedValue({ id: "form-1", organizationId: "org-a" });
    findUniqueField.mockResolvedValue(null);
    const { createFormField } = await import("../forms");
    const field = await createFormField("org-a", "form-1", "user-1", {
      fieldKey: "email",
      label: "Email",
      fieldType: "EMAIL",
      targetEntity: "MEMBER",
      targetField: "email",
      sensitivity: "LOW", // email's real floor is HIGH -- must not be honored
    });
    expect(field.sensitivity).toBe("HIGH");
  });

  it("rejects a duplicate fieldKey on the same form", async () => {
    findFirstForm.mockResolvedValue({ id: "form-1", organizationId: "org-a" });
    findUniqueField.mockResolvedValue({ id: "existing" });
    const { createFormField } = await import("../forms");
    await expect(
      createFormField("org-a", "form-1", "user-1", { fieldKey: "email", label: "Email", fieldType: "EMAIL", targetEntity: "MEMBER", targetField: "email" })
    ).rejects.toMatchObject({ code: "MEMBER_INTAKE_FIELD_KEY_TAKEN" });
  });
});

describe("form lifecycle", () => {
  it("refuses to publish a form with zero fields", async () => {
    countFields.mockResolvedValue(0);
    const { publishIntakeForm } = await import("../forms");
    await expect(publishIntakeForm("org-a", "form-1", "user-1")).rejects.toMatchObject({ code: "MEMBER_INTAKE_VALIDATION_ERROR" });
    expect(updateForm).not.toHaveBeenCalled();
  });

  it("publishes a DRAFT form with at least one field", async () => {
    countFields.mockResolvedValue(1);
    findFirstForm.mockResolvedValue({ id: "form-1", organizationId: "org-a", status: "DRAFT" });
    updateForm.mockResolvedValue({ id: "form-1", status: "ACTIVE" });
    const { publishIntakeForm } = await import("../forms");
    const result = await publishIntakeForm("org-a", "form-1", "user-1");
    expect(result.status).toBe("ACTIVE");
  });

  it("refuses an illegal transition (ARCHIVED -> ACTIVE)", async () => {
    findFirstForm.mockResolvedValue({ id: "form-1", organizationId: "org-a", status: "ARCHIVED" });
    const { resumeIntakeForm } = await import("../forms");
    await expect(resumeIntakeForm("org-a", "form-1", "user-1")).rejects.toMatchObject({ code: "MEMBER_INTAKE_INVALID_STATUS_TRANSITION" });
    expect(updateForm).not.toHaveBeenCalled();
  });
});

describe("regenerateIntakeFormToken", () => {
  it("issues a new token and bumps tokenVersion so the old link stops resolving", async () => {
    findFirstForm.mockResolvedValue({ id: "form-1", organizationId: "org-a", publicToken: "old-token", tokenVersion: 3 });
    updateForm.mockImplementation((args: { data: Record<string, unknown> }) => ({ id: "form-1", ...args.data }));
    const { regenerateIntakeFormToken } = await import("../forms");
    const result = await regenerateIntakeFormToken("org-a", "form-1", "user-1");
    expect(result.publicToken).not.toBe("old-token");
    expect(updateForm).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tokenVersion: { increment: 1 } }) })
    );
  });
});

describe("resolvePublicIntakeForm — no-enumeration discipline", () => {
  it("returns null for an unknown token", async () => {
    findUniqueForm.mockResolvedValue(null);
    const { resolvePublicIntakeForm } = await import("../forms");
    expect(await resolvePublicIntakeForm("nope")).toBeNull();
  });

  it("returns null for a DRAFT form (not yet published)", async () => {
    findUniqueForm.mockResolvedValue({ id: "form-1", status: "DRAFT", expiresAt: null, organization: {}, fields: [] });
    const { resolvePublicIntakeForm } = await import("../forms");
    expect(await resolvePublicIntakeForm("tok")).toBeNull();
  });

  it("returns null for a PAUSED form", async () => {
    findUniqueForm.mockResolvedValue({ id: "form-1", status: "PAUSED", expiresAt: null, organization: {}, fields: [] });
    const { resolvePublicIntakeForm } = await import("../forms");
    expect(await resolvePublicIntakeForm("tok")).toBeNull();
  });

  it("returns null for an expired form", async () => {
    findUniqueForm.mockResolvedValue({ id: "form-1", status: "ACTIVE", expiresAt: new Date(Date.now() - 1000), organization: {}, fields: [] });
    const { resolvePublicIntakeForm } = await import("../forms");
    expect(await resolvePublicIntakeForm("tok")).toBeNull();
  });

  it("resolves an ACTIVE, unexpired form without exposing organizationId-adjacent internals beyond the documented public shape", async () => {
    findUniqueForm.mockResolvedValue({
      id: "form-1",
      organizationId: "org-a",
      status: "ACTIVE",
      expiresAt: null,
      title: "Join Us",
      description: null,
      successMessage: null,
      organization: { id: "org-a", name: "Demo Org", logoUrl: null },
      fields: [],
    });
    const { resolvePublicIntakeForm } = await import("../forms");
    const result = await resolvePublicIntakeForm("tok");
    expect(result?.title).toBe("Join Us");
    expect(result?.organizationName).toBe("Demo Org");
  });

});

describe("resolvePublicIntakeSourceId — forged/foreign source tokens", () => {
  it("resolves to null (rather than throwing) for a source token that doesn't belong to this form, without blocking anything else", async () => {
    findFirstSource.mockResolvedValue(null);
    const { resolvePublicIntakeSourceId } = await import("../forms");
    expect(await resolvePublicIntakeSourceId("form-1", "forged-source-token")).toBeNull();
  });

  it("returns null when no source token is supplied at all", async () => {
    const { resolvePublicIntakeSourceId } = await import("../forms");
    expect(await resolvePublicIntakeSourceId("form-1", null)).toBeNull();
    expect(findFirstSource).not.toHaveBeenCalled();
  });
});
