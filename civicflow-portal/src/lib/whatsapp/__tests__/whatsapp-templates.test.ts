import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueTemplate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsAppTemplate: {
      findUnique: (...args: unknown[]) => findUniqueTemplate(...args),
    },
  },
}));

import { getActiveTemplate, validateTemplateVariables } from "@/lib/whatsapp/templates";

describe("getActiveTemplate", () => {
  beforeEach(() => {
    findUniqueTemplate.mockReset();
  });

  it("returns null when no template matches the key", async () => {
    findUniqueTemplate.mockResolvedValueOnce(null);
    expect(await getActiveTemplate("missing_key")).toBeNull();
  });

  it("returns null for an inactive template, even if approved", async () => {
    findUniqueTemplate.mockResolvedValueOnce({ active: false, approvalStatus: "APPROVED" });
    expect(await getActiveTemplate("meeting_reminder")).toBeNull();
  });

  it("returns null for an active template that isn't approved yet", async () => {
    findUniqueTemplate.mockResolvedValueOnce({ active: true, approvalStatus: "SUBMITTED" });
    expect(await getActiveTemplate("meeting_reminder")).toBeNull();
  });

  it("returns the template when active and approved", async () => {
    const template = { active: true, approvalStatus: "APPROVED", key: "meeting_reminder" };
    findUniqueTemplate.mockResolvedValueOnce(template);
    expect(await getActiveTemplate("meeting_reminder")).toBe(template);
  });
});

describe("validateTemplateVariables", () => {
  const template = {
    variablesSchema: [
      { name: "date", required: true },
      { name: "note", required: false, maxLength: 10 },
    ],
  } as never;

  it("rejects a missing required variable", () => {
    const result = validateTemplateVariables(template, {});
    expect(result.valid).toBe(false);
  });

  it("rejects a variable exceeding its maxLength", () => {
    const result = validateTemplateVariables(template, { date: "Aug 10", note: "way too long for the limit" });
    expect(result.valid).toBe(false);
  });

  it("accepts valid required + optional variables, dropping unlisted keys", () => {
    const result = validateTemplateVariables(template, { date: "Aug 10", note: "short", extra: "dropped" });
    expect(result).toEqual({ valid: true, variables: { date: "Aug 10", note: "short" } });
  });

  it("accepts when only the required variable is present", () => {
    const result = validateTemplateVariables(template, { date: "Aug 10" });
    expect(result).toEqual({ valid: true, variables: { date: "Aug 10" } });
  });

  it("treats a malformed (non-array) variablesSchema as no variables required", () => {
    const malformed = { variablesSchema: null } as never;
    const result = validateTemplateVariables(malformed, {});
    expect(result).toEqual({ valid: true, variables: {} });
  });
});
