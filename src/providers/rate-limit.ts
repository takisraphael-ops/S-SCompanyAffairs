/**
 * Token-bucket rate limiter.
 *
 * Caveat worth knowing: this is per-process. On a serverless host, concurrent
 * function instances each get their own bucket, so the effective rate is
 * (instances x rate). P0 runs ingest as a single scheduled job, so one bucket
 * is accurate. If ingest is ever fanned out, this needs to move to Redis or
 * the job needs to stay single-flight.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private queue: Array<() => void> = [];
  private draining = false;

  /**
   * @param capacity   burst size
   * @param perSecond  sustained refill rate
   */
  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.perSecond);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1 && this.queue.length === 0) {
      this.tokens -= 1;
      return;
    }
    // FIFO so a burst of callers is served in order rather than starving.
    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        this.refill();
        if (this.tokens >= 1) {
          this.tokens -= 1;
          this.queue.shift()?.();
          continue;
        }
        const deficit = 1 - this.tokens;
        const waitMs = Math.max(10, Math.ceil((deficit / this.perSecond) * 1000));
        await sleep(waitMs);
      }
    } finally {
      this.draining = false;
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
