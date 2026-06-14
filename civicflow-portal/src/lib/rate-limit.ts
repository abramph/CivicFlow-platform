type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const memoryStore = new Map<string, Bucket>();

function nowMs() {
  return Date.now();
}

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

function makeKey(scope: string, request: Request): string {
  const ip = getClientIp(request);
  return `${scope}:${ip}`;
}

function checkMemoryLimit(key: string, limit: number, windowMs: number): RateLimitDecision {
  const currentTime = nowMs();
  const bucket = memoryStore.get(key);

  if (!bucket || currentTime >= bucket.resetAt) {
    memoryStore.set(key, { count: 1, resetAt: currentTime + windowMs });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000)),
    };
  }

  bucket.count += 1;
  memoryStore.set(key, bucket);
  return {
    allowed: true,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000)),
  };
}

/**
 * Rate limit abstraction.
 * Current implementation: in-memory (dev-safe).
 * Production recommendation: implement Redis provider (Upstash / DO Managed Redis).
 */
export async function applyRateLimit(params: {
  scope: string;
  request: Request;
  limit: number;
  windowMs: number;
}): Promise<RateLimitDecision> {
  const key = makeKey(params.scope, params.request);

  // TODO(Phase 4): Add Redis-backed branch using RATE_LIMIT_REDIS_URL/TOKEN.
  // For now we use deterministic memory limiter for both dev and fallback production.
  return checkMemoryLimit(key, params.limit, params.windowMs);
}

export async function requireRateLimit(params: {
  scope: string;
  request: Request;
  limit: number;
  windowMs: number;
}): Promise<Response | null> {
  const result = await applyRateLimit(params);
  if (result.allowed) return null;

  return Response.json(
    {
      ok: false,
      error: "Rate limit exceeded. Please retry later.",
      retryAfterSeconds: result.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
      },
    }
  );
}
