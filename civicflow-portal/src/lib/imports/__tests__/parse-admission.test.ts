import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  withParseAdmission,
  ParseAdmissionDeniedError,
  configureParseAdmissionForTests,
  resetParseAdmissionStateForTests,
  getParseAdmissionSnapshotForTests,
} from "../parse-admission";

/**
 * Worker-isolation follow-up (Security Patch A deployment review).
 *
 * Tests the process-local concurrency admission controller in isolation
 * from the real worker -- `withParseAdmission` wraps any async function,
 * so these use controllable fake "work" (deferred promises) rather than
 * spawning real worker_threads.Worker instances, keeping this suite fast
 * and deterministic while still exercising the real slot/queue logic.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  resetParseAdmissionStateForTests();
  configureParseAdmissionForTests({ maxConcurrent: 1, maxQueueLength: 2, retryAfterSeconds: 5 });
});

afterEach(() => {
  resetParseAdmissionStateForTests();
});

describe("withParseAdmission -- global concurrency", () => {
  it("runs a single request immediately when no slot is in use", async () => {
    const result = await withParseAdmission("org-a", async () => "done");
    expect(result).toBe("done");
    expect(getParseAdmissionSnapshotForTests().activeCount).toBe(0);
  });

  it("queues a second, different-org request when the single slot is occupied, then runs it once released", async () => {
    const first = deferred<string>();
    const firstRun = withParseAdmission("org-a", () => first.promise);

    // Let the first request actually acquire its slot.
    await new Promise((r) => setTimeout(r, 10));
    expect(getParseAdmissionSnapshotForTests().activeCount).toBe(1);

    const secondRun = withParseAdmission("org-b", async () => "org-b-result");
    await new Promise((r) => setTimeout(r, 10));
    expect(getParseAdmissionSnapshotForTests().queueLength).toBe(1);

    first.resolve("org-a-result");
    await expect(firstRun).resolves.toBe("org-a-result");
    await expect(secondRun).resolves.toBe("org-b-result");
  });

  it("rejects with GLOBAL_CAPACITY once the active slot AND the bounded queue are both full", async () => {
    const blockers = [deferred<string>(), deferred<string>(), deferred<string>()];
    const runs = [
      withParseAdmission("org-a", () => blockers[0].promise),
      withParseAdmission("org-b", () => blockers[1].promise),
      withParseAdmission("org-c", () => blockers[2].promise),
    ];
    await new Promise((r) => setTimeout(r, 10));
    // maxConcurrent=1, maxQueueLength=2 -> org-a active, org-b + org-c queued, capacity now full.
    expect(getParseAdmissionSnapshotForTests()).toMatchObject({ activeCount: 1, queueLength: 2 });

    await expect(withParseAdmission("org-d", async () => "should never run")).rejects.toThrow(ParseAdmissionDeniedError);
    await expect(withParseAdmission("org-d", async () => "should never run")).rejects.toMatchObject({ reason: "GLOBAL_CAPACITY" });

    blockers.forEach((b, i) => b.resolve(`result-${i}`));
    await Promise.all(runs);
  });

  it("never calls the wrapped function when admission is denied outright (slot and queue both full)", async () => {
    const blockers = [deferred<string>(), deferred<string>(), deferred<string>()];
    withParseAdmission("org-a", () => blockers[0].promise); // takes the active slot
    withParseAdmission("org-b", () => blockers[1].promise); // fills queue slot 1
    withParseAdmission("org-c", () => blockers[2].promise); // fills queue slot 2
    await new Promise((r) => setTimeout(r, 10));
    expect(getParseAdmissionSnapshotForTests()).toMatchObject({ activeCount: 1, queueLength: 2 });

    let deniedCalled = false;
    await expect(
      withParseAdmission("org-d", async () => {
        deniedCalled = true;
        return "x";
      })
    ).rejects.toBeInstanceOf(ParseAdmissionDeniedError);
    expect(deniedCalled).toBe(false);

    blockers.forEach((b, i) => b.resolve(`result-${i}`));
  });
});

describe("withParseAdmission -- organization fairness", () => {
  it("rejects a second simultaneous request from the SAME organization with ORG_ALREADY_IN_FLIGHT, without waiting for a global-capacity check", async () => {
    const blocker = deferred<string>();
    const firstRun = withParseAdmission("org-a", () => blocker.promise);
    await new Promise((r) => setTimeout(r, 10));

    await expect(withParseAdmission("org-a", async () => "second")).rejects.toMatchObject({ reason: "ORG_ALREADY_IN_FLIGHT" });

    blocker.resolve("first-done");
    await firstRun;
  });

  it("prevents one organization from occupying more than one queue slot at a time", async () => {
    const blockers = [deferred<string>(), deferred<string>()];
    withParseAdmission("org-a", () => blockers[0].promise); // active
    const orgBFirstQueued = withParseAdmission("org-b", () => blockers[1].promise); // queued
    await new Promise((r) => setTimeout(r, 10));
    expect(getParseAdmissionSnapshotForTests().queuedOrgs).toEqual(["org-b"]);

    // org-b tries to queue a SECOND request while its first is still queued.
    await expect(withParseAdmission("org-b", async () => "third")).rejects.toMatchObject({ reason: "ORG_ALREADY_IN_FLIGHT" });

    // A different org can still use the remaining queue slot.
    const orgCQueued = withParseAdmission("org-c", async () => "org-c-result");
    await new Promise((r) => setTimeout(r, 10));
    expect(getParseAdmissionSnapshotForTests().queuedOrgs.sort()).toEqual(["org-b", "org-c"]);

    blockers[0].resolve("a-done");
    blockers[1].resolve("org-b-result");
    await expect(orgBFirstQueued).resolves.toBe("org-b-result");
    await expect(orgCQueued).resolves.toBe("org-c-result");
  });

  it("does not let one organization's occupied slot block a DIFFERENT organization's admission, when global capacity allows both", async () => {
    // maxConcurrent=1 means only one parse can run at all regardless of
    // organization -- that is the GLOBAL capacity limit, a separate
    // concern from per-org fairness. Raising it to 2 here isolates what
    // this test is actually about: org-b must not be denied or queued
    // behind org-a merely because org-a is active, as long as a global
    // slot is genuinely free.
    configureParseAdmissionForTests({ maxConcurrent: 2, maxQueueLength: 2, retryAfterSeconds: 5 });
    const blocker = deferred<string>();
    withParseAdmission("org-a", () => blocker.promise);
    await new Promise((r) => setTimeout(r, 10));

    const orgBResult = await withParseAdmission("org-b", async () => "org-b-ran-while-org-a-active");
    expect(orgBResult).toBe("org-b-ran-while-org-a-active");

    blocker.resolve("done");
  });
});

describe("withParseAdmission -- slot release on every outcome", () => {
  it("releases the slot after a successful run", async () => {
    await withParseAdmission("org-a", async () => "ok");
    expect(getParseAdmissionSnapshotForTests().activeCount).toBe(0);
    expect(getParseAdmissionSnapshotForTests().activeOrgs).toEqual([]);
  });

  it("releases the slot after the wrapped function throws", async () => {
    await expect(
      withParseAdmission("org-a", async () => {
        throw new Error("validation failed");
      })
    ).rejects.toThrow("validation failed");
    expect(getParseAdmissionSnapshotForTests().activeCount).toBe(0);
    expect(getParseAdmissionSnapshotForTests().activeOrgs).toEqual([]);
  });

  it("releases the slot after the wrapped function rejects asynchronously (simulated timeout/crash)", async () => {
    await expect(
      withParseAdmission("org-a", () => Promise.reject(new Error("WORKER_TIMEOUT")))
    ).rejects.toThrow("WORKER_TIMEOUT");
    expect(getParseAdmissionSnapshotForTests().activeCount).toBe(0);
  });

  it("frees the slot for the next queued request immediately after release, with no starvation", async () => {
    const order: string[] = [];
    const blockers = [deferred<void>(), deferred<void>(), deferred<void>()];

    const run = (org: string, blocker: ReturnType<typeof deferred<void>>) =>
      withParseAdmission(org, async () => {
        order.push(`${org}-start`);
        await blocker.promise;
        order.push(`${org}-end`);
      });

    const p1 = run("org-a", blockers[0]);
    await new Promise((r) => setTimeout(r, 10));
    const p2 = run("org-b", blockers[1]);
    const p3 = run("org-c", blockers[2]);
    await new Promise((r) => setTimeout(r, 10));

    blockers[0].resolve();
    await p1;
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toContain("org-b-start"); // org-b, not org-c, got the slot next (FIFO, no starvation)

    blockers[1].resolve();
    await p2;
    blockers[2].resolve();
    await p3;

    expect(order).toEqual(["org-a-start", "org-a-end", "org-b-start", "org-b-end", "org-c-start", "org-c-end"]);
  });
});
