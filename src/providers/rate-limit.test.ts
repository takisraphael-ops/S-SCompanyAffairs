import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  it("serves an initial burst up to capacity without delay", async () => {
    const limiter = new RateLimiter(5, 1);
    const started = Date.now();
    for (let i = 0; i < 5; i++) await limiter.acquire();
    assert.ok(
      Date.now() - started < 50,
      "burst within capacity should not block",
    );
  });

  it("throttles once the bucket is empty", async () => {
    // Capacity 1, 20/sec => each acquire past the first waits ~50ms.
    const limiter = new RateLimiter(1, 20);
    const started = Date.now();
    for (let i = 0; i < 4; i++) await limiter.acquire();
    const elapsed = Date.now() - started;

    assert.ok(elapsed >= 120, `expected throttling, took ${elapsed}ms`);
    assert.ok(elapsed < 600, `throttled too aggressively, took ${elapsed}ms`);
  });

  it("serves queued callers in FIFO order", async () => {
    const limiter = new RateLimiter(1, 50);
    const order: number[] = [];

    await Promise.all(
      [0, 1, 2, 3].map(async (i) => {
        await limiter.acquire();
        order.push(i);
      }),
    );

    assert.deepEqual(order, [0, 1, 2, 3]);
  });
});
