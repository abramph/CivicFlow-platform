import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({ session: { userId: "user-1", userEmail: "admin@example.com" }, organizationId: "org-a", role: "ORG_OWNER" }),
  };
});

const resolveCommunicationRecipients = vi.fn();
vi.mock("@/lib/communication-campaigns", () => ({
  resolveCommunicationRecipients: (...args: unknown[]) => resolveCommunicationRecipients(...args),
}));

import { ValidationError } from "@/lib/validation";
import { POST } from "@/app/api/communications/campaigns/preview-recipients/route";

function postReq(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/communications/campaigns/preview-recipients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resolveCommunicationRecipients.mockReset();
});

describe("POST /api/communications/campaigns/preview-recipients", () => {
  it("returns a count from the exact same resolver the real create flow uses, without persisting anything", async () => {
    resolveCommunicationRecipients.mockResolvedValueOnce([{ id: "member-1" }, { id: "member-2" }, { id: "member-3" }]);

    const response = await POST(postReq({ recipientFilter: { selector: "pta_target", ptaRule: { type: "committee", committeeId: "committee-1" } }, channel: "EMAIL" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.count).toBe(3);
    expect(resolveCommunicationRecipients).toHaveBeenCalledWith(
      "org-a",
      { selector: "pta_target", ptaRule: { type: "committee", committeeId: "committee-1" } },
      "EMAIL"
    );
  });

  it("propagates a validation error from the resolver (e.g. non-PTA org, malformed rule) as a 400, not a silent count", async () => {
    resolveCommunicationRecipients.mockRejectedValueOnce(new ValidationError("PTA targeting is only available for PTA organizations."));

    const response = await POST(postReq({ recipientFilter: { selector: "pta_target" }, channel: "EMAIL" }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for a missing channel", async () => {
    const response = await POST(postReq({ recipientFilter: { selector: "active_with_email" } }));
    expect(response.status).toBe(400);
    expect(resolveCommunicationRecipients).not.toHaveBeenCalled();
  });
});
