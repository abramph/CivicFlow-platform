/**
 * Worker-isolation follow-up (Security Patch A deployment review).
 *
 * Process-local admission control for spreadsheet parsing. Even with
 * parsing isolated into a worker thread (spreadsheet-parser-worker-
 * client.ts) and organization-scoped rate limiting on the HTTP layer
 * (rate-limit.ts), nothing previously stopped several *simultaneous*
 * parses -- from one organization's concurrent requests, or several
 * different organizations' requests landing at the same moment -- from
 * each spinning up their own worker with its own heap ceiling, on a
 * single `apps-s-1vcpu-1gb` production instance that also runs Next.js,
 * Prisma, and every other concurrent request.
 *
 * This is a simple counting semaphore plus a small bounded FIFO queue,
 * entirely in-memory and scoped to this one Node process -- explicitly
 * NOT a distributed mechanism. That is a deliberate, documented match
 * for the current single-instance deployment (confirmed via `doctl apps
 * spec get`: `instance_count: 1`, one `web` service, no separate worker
 * component). If this application is ever scaled to more than one
 * instance, a distributed concurrency mechanism (e.g. a Redis-backed
 * counter, mirroring how rate-limit.ts already has a Redis backend
 * ready for exactly this kind of multi-instance need) would be required
 * -- this module does not attempt to solve that ahead of time.
 */

export class ParseAdmissionDeniedError extends Error {
  readonly reason: "GLOBAL_CAPACITY" | "ORG_ALREADY_IN_FLIGHT";
  readonly retryAfterSeconds: number;
  constructor(reason: "GLOBAL_CAPACITY" | "ORG_ALREADY_IN_FLIGHT", message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "ParseAdmissionDeniedError";
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface QueueEntry {
  organizationId: string;
  resolve: () => void;
}

interface AdmissionConfig {
  maxConcurrent: number;
  maxQueueLength: number;
  /** A conservative fallback for a caller waiting in the queue -- not a
   * hard bound on how long a queued request can wait (that is governed
   * by the caller's own request lifecycle / worker timeout), just what
   * `Retry-After` communicates to a REJECTED (not queued) request. */
  retryAfterSeconds: number;
}

// Sized for the current single apps-s-1vcpu-1gb production instance (1
// shared vCPU, 1 GiB total memory) -- one spreadsheet parse actively
// running at a time, with room for at most 2 more to wait briefly rather
// than being rejected outright, matching the review's explicit guidance
// ("bounded queue: preferably 0-2 waiting requests").
const DEFAULT_CONFIG: AdmissionConfig = {
  maxConcurrent: 1,
  maxQueueLength: 2,
  retryAfterSeconds: 5,
};

let config: AdmissionConfig = { ...DEFAULT_CONFIG };
let activeCount = 0;
const activeOrgs = new Set<string>();
const queuedOrgs = new Set<string>();
const queue: QueueEntry[] = [];

function tryDequeueNext(): void {
  if (activeCount >= config.maxConcurrent) return;
  const next = queue.shift();
  if (!next) return;
  queuedOrgs.delete(next.organizationId);
  activeCount += 1;
  activeOrgs.add(next.organizationId);
  next.resolve();
}

function release(organizationId: string): void {
  activeCount = Math.max(0, activeCount - 1);
  activeOrgs.delete(organizationId);
  tryDequeueNext();
}

/** Acquires one parse slot for `organizationId`, or throws
 * ParseAdmissionDeniedError immediately. Never queues a second request
 * from an organization that already has one active-or-queued -- this is
 * what keeps one organization from occupying the whole bounded queue by
 * itself, distinct from (and in addition to) the request-rate limiter in
 * rate-limit.ts, which bounds requests over *time* rather than
 * simultaneous in-flight work. */
async function acquire(organizationId: string): Promise<void> {
  if (activeOrgs.has(organizationId) || queuedOrgs.has(organizationId)) {
    throw new ParseAdmissionDeniedError(
      "ORG_ALREADY_IN_FLIGHT",
      "Your organization already has a spreadsheet import in progress. Please wait for it to finish before starting another.",
      config.retryAfterSeconds
    );
  }

  if (activeCount < config.maxConcurrent) {
    activeCount += 1;
    activeOrgs.add(organizationId);
    return;
  }

  if (queue.length >= config.maxQueueLength) {
    throw new ParseAdmissionDeniedError(
      "GLOBAL_CAPACITY",
      "The server is busy processing other imports right now. Please try again shortly.",
      config.retryAfterSeconds
    );
  }

  queuedOrgs.add(organizationId);
  await new Promise<void>((resolve) => {
    queue.push({ organizationId, resolve });
  });
}

/**
 * Runs `fn` under a process-local admission slot scoped to
 * `organizationId`. Throws ParseAdmissionDeniedError without ever
 * calling `fn` if no slot is available. The slot is released on every
 * outcome -- success, thrown error, or fn's own rejection -- via
 * `finally`, so a crash inside `fn` can never leak a permanently-held
 * slot.
 */
export async function withParseAdmission<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
  await acquire(organizationId);
  try {
    return await fn();
  } finally {
    release(organizationId);
  }
}

export function getParseAdmissionSnapshotForTests(): { activeCount: number; queueLength: number; activeOrgs: string[]; queuedOrgs: string[] } {
  return {
    activeCount,
    queueLength: queue.length,
    activeOrgs: Array.from(activeOrgs),
    queuedOrgs: Array.from(queuedOrgs),
  };
}

export function configureParseAdmissionForTests(overrides: Partial<AdmissionConfig>): void {
  config = { ...DEFAULT_CONFIG, ...overrides };
}

export function resetParseAdmissionStateForTests(): void {
  config = { ...DEFAULT_CONFIG };
  activeCount = 0;
  activeOrgs.clear();
  queuedOrgs.clear();
  queue.length = 0;
}
