import { describe, expect, it } from "vitest";
import { retrieveKnowledgeChunks } from "../knowledge/retriever";

describe("retrieveKnowledgeChunks", () => {
  it("retrieves relevant chunks for an on-topic question", () => {
    const chunks = retrieveKnowledgeChunks({ question: "How do I terminate a member?", visibility: "in_app", vertical: "COMMUNITY" });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.documentId === "member-admin-termination")).toBe(true);
  });

  it("never returns an in_app-only document to the public surface", () => {
    const chunks = retrieveKnowledgeChunks({ question: "How do I terminate a member?", visibility: "public", vertical: null });
    expect(chunks.some((c) => c.documentId === "member-admin-termination")).toBe(false);
  });

  it("returns a vertical-specific document only for its own vertical", () => {
    const hoaChunks = retrieveKnowledgeChunks({ question: "How do I submit an architectural request?", visibility: "in_app", vertical: "HOA" });
    expect(hoaChunks.some((c) => c.documentId === "hoa-architectural-requests")).toBe(true);

    const communityChunks = retrieveKnowledgeChunks({ question: "How do I submit an architectural request?", visibility: "in_app", vertical: "COMMUNITY" });
    expect(communityChunks.some((c) => c.documentId === "hoa-architectural-requests")).toBe(false);
  });

  it("returns an ALL-vertical document regardless of the caller's vertical", () => {
    const communityChunks = retrieveKnowledgeChunks({ question: "How do I reset my password?", visibility: "public", vertical: "COMMUNITY" });
    const hoaChunks = retrieveKnowledgeChunks({ question: "How do I reset my password?", visibility: "public", vertical: "HOA" });
    expect(communityChunks.some((c) => c.documentId === "account-password-reset")).toBe(true);
    expect(hoaChunks.some((c) => c.documentId === "account-password-reset")).toBe(true);
  });

  it("returns zero chunks for an unrelated/nonsense question -- the natural safety property the fallback relies on", () => {
    const chunks = retrieveKnowledgeChunks({ question: "asdkjf qwoeiru zzzznotarealquestion", visibility: "public", vertical: null });
    expect(chunks).toHaveLength(0);
  });

  it("never returns more than 4 chunks even for a broad, multi-topic question", () => {
    const chunks = retrieveKnowledgeChunks({
      question: "Tell me about members dues reports payments organization signup mobile app password reports",
      visibility: "in_app",
      vertical: "COMMUNITY",
    });
    expect(chunks.length).toBeLessThanOrEqual(4);
  });
});
