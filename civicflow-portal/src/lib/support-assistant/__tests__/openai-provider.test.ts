import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAISupportAssistantProvider } from "../providers/openai-provider";
import { SupportAssistantError } from "../errors";
import type { SupportAssistantContext } from "../types";

const baseContext: SupportAssistantContext = { mode: "public", vertical: null, roleCategory: "unknown", currentPath: null };
const baseRequest = {
  question: "How do I reset my password?",
  context: baseContext,
  chunks: [{ documentId: "account-password-reset", title: "Resetting your password", href: "/reset-password", text: "Use the forgot password link." }],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAISupportAssistantProvider", () => {
  it("sends system and user messages separately, delimits chunks, and never mixes untrusted content into the system role", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: JSON.stringify({ answer: "Use the link.", citedDocumentIds: ["account-password-reset"], confidence: "high" }) } }] })
    );
    const provider = new OpenAISupportAssistantProvider("test-key");
    await provider.respond(baseRequest);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toContain("[doc:account-password-reset]");
    expect(body.messages[0].content).not.toContain("How do I reset my password?");
  });

  it("resolves citations from citedDocumentIds against the actual request chunks, not from free-text", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: JSON.stringify({ answer: "Use the link.", citedDocumentIds: ["account-password-reset", "nonexistent-doc"], confidence: "high" }) } }] })
    );
    const provider = new OpenAISupportAssistantProvider("test-key");
    const result = await provider.respond(baseRequest);
    expect(result.citations).toEqual([{ title: "Resetting your password", href: "/reset-password" }]);
  });

  it("throws SUPPORT_ASSISTANT_PROVIDER_RATE_LIMITED on a 429", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 429 }));
    const provider = new OpenAISupportAssistantProvider("test-key");
    await expect(provider.respond(baseRequest)).rejects.toMatchObject({ code: "SUPPORT_ASSISTANT_PROVIDER_RATE_LIMITED" });
  });

  it("throws SUPPORT_ASSISTANT_PROVIDER_ERROR on a non-ok, non-429 status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    const provider = new OpenAISupportAssistantProvider("test-key");
    await expect(provider.respond(baseRequest)).rejects.toMatchObject({ code: "SUPPORT_ASSISTANT_PROVIDER_ERROR" });
  });

  it("throws SUPPORT_ASSISTANT_PROVIDER_TIMEOUT when the request is aborted", async () => {
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    vi.useFakeTimers();
    const provider = new OpenAISupportAssistantProvider("test-key");
    // Attach the rejection assertion synchronously before advancing timers,
    // so the rejection is "handled" from the moment it occurs rather than
    // racing the fake-timer advance (avoids a spurious unhandled-rejection
    // warning from Vitest even though the assertion itself always passes).
    const assertion = expect(provider.respond(baseRequest)).rejects.toMatchObject({ code: "SUPPORT_ASSISTANT_PROVIDER_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(20_001);
    await assertion;
    vi.useRealTimers();
  });

  it("rejects malformed (non-JSON) content from the model rather than surfacing it", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "not valid json" } }] }));
    const provider = new OpenAISupportAssistantProvider("test-key");
    await expect(provider.respond(baseRequest)).rejects.toMatchObject({ code: "SUPPORT_ASSISTANT_INVALID_PROVIDER_RESPONSE" });
  });

  it("rejects a response that doesn't match the expected schema", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: JSON.stringify({ totally: "wrong shape" }) } }] }));
    const provider = new OpenAISupportAssistantProvider("test-key");
    await expect(provider.respond(baseRequest)).rejects.toBeInstanceOf(SupportAssistantError);
  });

  it("rejects a response with no message content at all", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{}] }));
    const provider = new OpenAISupportAssistantProvider("test-key");
    await expect(provider.respond(baseRequest)).rejects.toMatchObject({ code: "SUPPORT_ASSISTANT_INVALID_PROVIDER_RESPONSE" });
  });
});
