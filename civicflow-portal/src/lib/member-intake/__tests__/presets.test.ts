import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * MEMBER-QR-H — presets.ts. Covers that every OrganizationVertical has a
 * preset, that instantiating one creates a DRAFT form via the SAME
 * createIntakeForm/createFormField functions every other form uses (never a
 * separate creation path), and that field ordering/target-field mapping is
 * preserved end to end.
 */

const createIntakeForm = vi.fn();
const createFormField = vi.fn();
const getIntakeForm = vi.fn();
const findUniqueOrThrowOrg = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrowOrg(...a) } },
}));
vi.mock("../forms", () => ({
  createIntakeForm: (...a: unknown[]) => createIntakeForm(...a),
  createFormField: (...a: unknown[]) => createFormField(...a),
  getIntakeForm: (...a: unknown[]) => getIntakeForm(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  createIntakeForm.mockResolvedValue({ id: "form-1" });
  createFormField.mockResolvedValue({ id: "field-1" });
  getIntakeForm.mockResolvedValue({ id: "form-1", fields: [] });
});

describe("getIntakeFormPreset / listIntakeFormPresets", () => {
  it("has a preset for every OrganizationVertical", async () => {
    const { listIntakeFormPresets } = await import("../presets");
    const verticals = listIntakeFormPresets().map((p) => p.vertical);
    expect(verticals.sort()).toEqual(["CHURCH", "COMMUNITY", "HOA", "PTA", "UNION"]);
  });

  it("gives every preset at least a first/last name field required", async () => {
    const { listIntakeFormPresets } = await import("../presets");
    for (const { preset } of listIntakeFormPresets()) {
      const firstName = preset.fields.find((f) => f.targetField === "firstName");
      const lastName = preset.fields.find((f) => f.targetField === "lastName");
      expect(firstName?.required).toBe(true);
      expect(lastName?.required).toBe(true);
    }
  });
});

describe("createFormFromPreset", () => {
  it("creates a DRAFT form via the shared createIntakeForm function, using the preset's own copy", async () => {
    const { createFormFromPreset, getIntakeFormPreset } = await import("../presets");
    await createFormFromPreset("org-a", "user-1", "CHURCH");

    const preset = getIntakeFormPreset("CHURCH");
    expect(createIntakeForm).toHaveBeenCalledWith("org-a", "user-1", expect.objectContaining({ name: preset.name, title: preset.title }));
  });

  it("creates every preset field via the shared createFormField function, preserving order", async () => {
    const { createFormFromPreset, getIntakeFormPreset } = await import("../presets");
    await createFormFromPreset("org-a", "user-1", "UNION");

    const preset = getIntakeFormPreset("UNION");
    expect(createFormField).toHaveBeenCalledTimes(preset.fields.length);
    preset.fields.forEach((field, index) => {
      expect(createFormField).toHaveBeenNthCalledWith(
        index + 1,
        "org-a",
        "form-1",
        "user-1",
        expect.objectContaining({ fieldKey: field.fieldKey, order: index })
      );
    });
  });

  it("returns the fully-loaded form (with fields) via getIntakeForm rather than the bare create result", async () => {
    getIntakeForm.mockResolvedValue({ id: "form-1", fields: [{ id: "field-1" }] });
    const { createFormFromPreset } = await import("../presets");
    const result = await createFormFromPreset("org-a", "user-1", "COMMUNITY");
    expect(result.fields).toHaveLength(1);
  });
});

describe("getOrganizationVertical", () => {
  it("reads the organization's own primaryVertical fresh from the database", async () => {
    findUniqueOrThrowOrg.mockResolvedValue({ primaryVertical: "PTA" });
    const { getOrganizationVertical } = await import("../presets");
    const vertical = await getOrganizationVertical("org-a");
    expect(vertical).toBe("PTA");
    expect(findUniqueOrThrowOrg).toHaveBeenCalledWith({ where: { id: "org-a" }, select: { primaryVertical: true } });
  });
});
