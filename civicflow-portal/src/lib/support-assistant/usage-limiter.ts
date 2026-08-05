import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { recordLabUsage } from "@/lib/labs/usage";
import { SupportAssistantError } from "./errors";

const PUBLIC_RATE_LIMIT = { scope: "api:support-assistant:public", limit: 10, windowMs: 60_000 };
const AUTHENTICATED_RATE_LIMIT = { scope: "api:support-assistant:authenticated", limit: 20, windowMs: 60_000 };
const AUTHENTICATED_DAILY_LIMIT = 50;
const ANONYMOUS_DAILY_LIMIT_PER_IP = 20;

/**
 * In-memory daily counter for anonymous requests, mirroring
 * src/lib/rate-limit.ts's own in-memory-fallback shape. There's no
 * organization or user to meter an anonymous visitor against, so this is a
 * coarse, single-instance-scoped ceiling -- a "don't enable unlimited public
 * chat" backstop, not a durable cross-instance/billing-grade limit. The
 * authenticated path below uses the durable LabUsageEvent table instead,
 * since it has a real organizationId to key on.
 */
const anonymousDailyCounts = new Map<string, { day: string; count: number }>();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function enforcePublicUsageLimits(request: Request): Promise<void> {
  const rateLimited = await requireRateLimit({ ...PUBLIC_RATE_LIMIT, request });
  if (rateLimited) {
    throw new SupportAssistantError("SUPPORT_ASSISTANT_RATE_LIMITED", "Too many requests. Please wait a moment and try again.");
  }
  const ip = clientIp(request);
  const day = todayKey();
  const existing = anonymousDailyCounts.get(ip);
  const count = existing && existing.day === day ? existing.count : 0;
  if (count >= ANONYMOUS_DAILY_LIMIT_PER_IP) {
    throw new SupportAssistantError(
      "SUPPORT_ASSISTANT_DAILY_LIMIT_REACHED",
      "Daily question limit reached. Please contact Unestra Support or try again tomorrow."
    );
  }
  anonymousDailyCounts.set(ip, { day, count: count + 1 });
}

export async function enforceAuthenticatedUsageLimits(request: Request, organizationId: string): Promise<void> {
  const rateLimited = await requireRateLimit({ ...AUTHENTICATED_RATE_LIMIT, request });
  if (rateLimited) {
    throw new SupportAssistantError("SUPPORT_ASSISTANT_RATE_LIMITED", "Too many requests. Please wait a moment and try again.");
  }
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const todayCount = await prisma.labUsageEvent.count({
    where: { organizationId, featureKey: "supportAssistant", recordedAt: { gte: since } },
  });
  if (todayCount >= AUTHENTICATED_DAILY_LIMIT) {
    throw new SupportAssistantError(
      "SUPPORT_ASSISTANT_DAILY_LIMIT_REACHED",
      "This organization has reached its daily Support Assistant question limit. Please try again tomorrow."
    );
  }
}

/** A rough, deliberately conservative token estimate (chars / 4) -- good
 * enough for a usage ceiling, not a billing-accurate count. The OpenAI
 * provider's actual `usage` field isn't parsed in v1 (matching the existing
 * Meeting Intelligence integration, which also doesn't parse it) -- flagged
 * in docs/support-assistant.md as a fast-follow once real spend needs
 * precise tracking. */
export function estimateTokens(question: string, answer: string): number {
  return Math.ceil((question.length + answer.length) / 4);
}

export async function recordAuthenticatedUsage(organizationId: string, estimatedTokens: number): Promise<void> {
  await recordLabUsage({
    organizationId,
    featureKey: "supportAssistant",
    unit: "ai_tokens",
    quantity: Math.max(1, estimatedTokens),
  });
}
