import { Redis } from "@upstash/redis";

type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

// ── In-memory store (dev / single-instance fallback) ─────────────────────────

const memoryStore = new Map<string, Bucket>();

function checkMemoryLimit(key: string, limit: number, windowMs: number): RateLimitDecision {
  const now = Date.now();
  const bucket = memoryStore.get(key);

  if (!bucket || now >= bucket.resetAt) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

// ── Redis store (multi-instance production) ───────────────────────────────────

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.RATE_LIMIT_REDIS_URL;
  const token = process.env.RATE_LIMIT_REDIS_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

// Atomic fixed-window counter via Lua: INCR + conditional PEXPIRE in one round-trip.
const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
local pttl = redis.call('PTTL', KEYS[1])
return {count, pttl}
`;

async function checkRedisLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitDecision> {
  const raw = await redis.eval(RATE_LIMIT_SCRIPT, [key], [limit, windowMs]);
  const result = raw as [number, number];
  const count = result[0];
  const pttlMs = result[1] > 0 ? result[1] : windowMs;

  if (count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(pttlMs / 1000)) };
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: Math.ceil(pttlMs / 1000),
  };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function makeKey(scope: string, request: Request): string {
  return `rl:${scope}:${getClientIp(request)}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function applyRateLimit(params: {
  scope: string;
  request: Request;
  limit: number;
  windowMs: number;
}): Promise<RateLimitDecision> {
  const key = makeKey(params.scope, params.request);

  if (process.env.CIVICFLOW_USE_MEMORY_RATE_LIMITER === "1") {
    return checkMemoryLimit(key, params.limit, params.windowMs);
  }

  const redis = getRedis();
  if (redis) {
    try {
      return await checkRedisLimit(redis, key, params.limit, params.windowMs);
    } catch {
      // Redis unavailable — fall through to memory limiter rather than failing open
      return checkMemoryLimit(key, params.limit, params.windowMs);
    }
  }

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
      headers: { "Retry-After": String(result.retryAfterSeconds) },
    }
  );
}
