import type { OrganizationVertical } from "@prisma/client";
import { KNOWLEDGE_DOCUMENTS, type KnowledgeDocument, type KnowledgeVisibility } from "./manifest";
import type { KnowledgeChunk } from "../types";

const MAX_CHUNKS = 4;
/** A question that scores below this against every document gets zero chunks
 * -- the policy layer then returns the fixed fallback rather than letting the
 * provider improvise from nothing. Scoring only against each document's
 * curated `keywords` (never its title or body text, which are much noisier
 * and were the actual cause of "unestra"/"member"-style false positives in
 * an earlier version of this function) is what makes a low threshold safe
 * here -- the specific adversarial patterns that share real product
 * vocabulary (e.g. a private dues-balance lookup) are caught independently
 * by policy.ts's containsUnsafeRequestPattern, not by this threshold. */
const MIN_SCORE = 1;

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Minimal singular/plural tolerance ("household" <-> "households") -- not a
 * real stemmer, just enough to not miss an obvious plural of a keyword the
 * question happens to use. */
function tokenMatches(token: string, questionTokens: Set<string>): boolean {
  if (questionTokens.has(token)) return true;
  if (questionTokens.has(`${token}s`)) return true;
  if (token.endsWith("s") && questionTokens.has(token.slice(0, -1))) return true;
  return false;
}

function scoreDocument(questionTokens: Set<string>, doc: KnowledgeDocument): number {
  let score = 0;
  for (const keyword of doc.keywords) {
    const keywordTokens = normalize(keyword);
    if (keywordTokens.length > 1) {
      // Multi-word keyword (e.g. "delinquent roster"): require every one of
      // its tokens to appear somewhere in the question, order-independent --
      // more forgiving of natural phrasing ("delinquent member roster") than
      // a strict contiguous substring match, while still requiring genuine
      // multi-word overlap rather than one incidental shared word.
      const allPresent = keywordTokens.every((token) => tokenMatches(token, questionTokens));
      if (allPresent) score += 3;
      continue;
    }
    if (tokenMatches(keywordTokens[0], questionTokens)) score += 1;
  }
  return score;
}

/**
 * Bounded keyword retrieval over the fixed, reviewed knowledge base -- no
 * embeddings/vector DB in v1 (see docs/support-assistant.md). Filters by
 * surface visibility and vertical before scoring, so a public visitor never
 * sees in-app-only content and a Community org never sees HOA-only content.
 */
export function retrieveKnowledgeChunks(input: {
  question: string;
  visibility: KnowledgeVisibility;
  vertical: OrganizationVertical | null;
}): KnowledgeChunk[] {
  const questionTokens = new Set(normalize(input.question));
  const candidates = KNOWLEDGE_DOCUMENTS.filter((doc) => {
    const visibilityMatch = doc.visibility === "both" || doc.visibility === input.visibility;
    const verticalMatch = doc.vertical === "ALL" || doc.vertical === input.vertical;
    return visibilityMatch && verticalMatch;
  });

  const scored = candidates
    .map((doc) => ({ doc, score: scoreDocument(questionTokens, doc) }))
    .filter((entry) => entry.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CHUNKS);

  return scored.map(({ doc }) => ({
    documentId: doc.id,
    title: doc.title,
    href: doc.href,
    text: doc.text,
  }));
}
