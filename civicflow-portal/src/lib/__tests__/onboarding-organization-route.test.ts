import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuth = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requireAuth: (...args: unknown[]) => requireAuth(...args),
  };
});

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({
  createAuditEvent: (...args: unknown[]) => createAuditEvent(...args),
}));

const findFirstMembership = vi.fn();
const createOrganization = vi.fn();
const createMembership = vi.fn();
const createOrgSettings = vi.fn();
const createCategory = vi.fn();
const createManyPaymentMethodConfig = vi.fn().mockResolvedValue({ count: 0 });
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationMembership: {
      findFirst: (...args: unknown[]) => findFirstMembership(...args),
      create: (...args: unknown[]) => createMembership(...args),
    },
    organization: { create: (...args: unknown[]) => createOrganization(...args) },
    orgSettings: { create: (...args: unknown[]) => createOrgSettings(...args) },
    category: { create: (...args: unknown[]) => createCategory(...args) },
    paymentMethodConfig: { createMany: (...args: unknown[]) => createManyPaymentMethodConfig(...args) },
  },
}));

import { POST } from "@/app/api/onboarding/organization/route";

function request(body: unknown) {
  return new Request("https://portal.test/api/onboarding/organization", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  name: "Oak Ridge Homeowners Association",
  slug: "oak-ridge-hoa",
};

describe("POST /api/onboarding/organization — primaryVertical requirement", () => {
  beforeEach(() => {
    requireAuth.mockReset();
    findFirstMembership.mockReset();
    createOrganization.mockReset();
    createMembership.mockReset();
    createOrgSettings.mockReset();
    createCategory.mockReset();
    createAuditEvent.mockClear();
  });

  it("rejects org creation with no primaryVertical selected", async () => {
    requireAuth.mockResolvedValueOnce({ userId: "u1", userEmail: "a@example.org" });
    findFirstMembership.mockResolvedValueOnce(null);

    const response = await POST(request({ ...baseBody }));

    expect(response.status).toBe(400);
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it("rejects an invalid vertical value rather than silently defaulting", async () => {
    requireAuth.mockResolvedValueOnce({ userId: "u1", userEmail: "a@example.org" });
    findFirstMembership.mockResolvedValueOnce(null);

    const response = await POST(request({ ...baseBody, primaryVertical: "NONPROFIT" }));

    expect(response.status).toBe(400);
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it("persists the selected vertical and audits it on successful creation", async () => {
    requireAuth.mockResolvedValueOnce({ userId: "u1", userEmail: "a@example.org" });
    findFirstMembership.mockResolvedValueOnce(null);
    createOrganization.mockResolvedValueOnce({
      id: "org-new",
      slug: "oak-ridge-hoa",
      name: "Oak Ridge Homeowners Association",
      primaryVertical: "HOA",
    });
    createMembership.mockResolvedValueOnce({});
    createOrgSettings.mockResolvedValueOnce({});

    const response = await POST(request({ ...baseBody, primaryVertical: "HOA" }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.ok).toBe(true);
    expect(createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ primaryVertical: "HOA" }) })
    );
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ primaryVertical: "HOA" }) })
    );
  });

  it("accepts each of the four supported verticals", async () => {
    for (const vertical of ["COMMUNITY", "PTA", "UNION", "HOA"]) {
      requireAuth.mockResolvedValueOnce({ userId: "u1", userEmail: "a@example.org" });
      findFirstMembership.mockResolvedValueOnce(null);
      createOrganization.mockResolvedValueOnce({ id: `org-${vertical}`, slug: "x", name: "X", primaryVertical: vertical });
      createMembership.mockResolvedValueOnce({});
      createOrgSettings.mockResolvedValueOnce({});

      const response = await POST(request({ ...baseBody, primaryVertical: vertical }));
      expect(response.status).toBe(201);
    }
  });
});
