// Simple in-memory rate limiter — no external dependency required.
// Not suitable for multi-process deployments; this server runs as a single
// PM2 process, so an in-process store is sufficient.

function createRateLimiter({ windowMs, limit, keyFn }) {
  const store = new Map(); // key -> { count, resetAt }

  // Sweep expired entries once per window so the Map doesn't grow unbounded.
  const sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of store) {
      if (entry.resetAt <= now) store.delete(k);
    }
  }, Math.max(windowMs, 60_000));

  if (sweepInterval.unref) sweepInterval.unref();

  const defaultKeyFn = (req) => {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    return `${ip}:${req.path}`;
  };

  return function rateLimitMiddleware(req, res, next) {
    const key = (keyFn || defaultKeyFn)(req);
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        success: false,
        error: "Too many requests. Please try again later.",
        retryAfter,
      });
    }

    next();
  };
}

module.exports = { createRateLimiter };
