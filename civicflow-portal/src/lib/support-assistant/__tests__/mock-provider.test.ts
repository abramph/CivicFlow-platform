import { describe, expect, it } from "vitest";
import { MockSupportAssistantProvider } from "../providers/mock-provider";
import type { SupportAssistantContext } from "../types";

const baseContext: SupportAssistantContext = { mode: "public", vertical: null, roleCategory: "unknown", currentPath: null };

describe("MockSupportAssistantProvider", () => {
  it("returns low confidence and no citations when given zero chunks", async () => {
    const provider = new MockSupportAssistantProvider();
    const result = await provider.respond({ question: "anything", context: baseContext, chunks: [] });
    expect(result.confidence).toBe("low");
    expect(result.citations).toEqual([]);
  });

  it("returns the chunk's own text and a citation for a single-chunk match", async () => {
    const provider = new MockSupportAssistantProvider();
    const result = await provider.respond({
      question: "how do I reset my password",
      context: baseContext,
      chunks: [{ documentId: "account-password-reset", title: "Resetting your password", href: "/reset-password", text: "Use the forgot password link." }],
    });
    expect(result.confidence).toBe("high");
    expect(result.answer).toContain("Use the forgot password link.");
    expect(result.citations).toEqual([{ title: "Resetting your password", href: "/reset-password" }]);
  });

  it("cites every retrieved chunk when there are multiple", async () => {
    const provider = new MockSupportAssistantProvider();
    const result = await provider.respond({
      question: "dues and reports",
      context: baseContext,
      chunks: [
        { documentId: "a", title: "Doc A", href: "/a", text: "Text A" },
        { documentId: "b", title: "Doc B", href: "/b", text: "Text B" },
      ],
    });
    expect(result.citations).toHaveLength(2);
  });
});
