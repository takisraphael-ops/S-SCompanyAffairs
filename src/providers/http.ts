import type { ZodType } from "zod";
import { ProviderError, codeForStatus, isProviderError } from "./errors";
import { RateLimiter, sleep } from "./rate-limit";

export interface FetchJsonOptions<T> {
  provider: string;
  /** Response contract. A mismatch is a hard failure, not a retryable blip. */
  schema: ZodType<T>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Retry attempts *after* the first try. */
  retries?: number;
  limiter?: RateLimiter;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 3;
const BASE_BACKOFF_MS = 300;
const MAX_BACKOFF_MS = 8_000;

/**
 * Strip credentials before a URL reaches an error message or a log line.
 * Finnhub passes the API key as a query parameter, so unredacted URLs in
 * error output would leak the key into logs and error trackers.
 */
export function redact(url: string): string {
  try {
    const u = new URL(url);
    for (const key of ["token", "apikey", "api_key", "apiKey", "access_key"]) {
      if (u.searchParams.has(key)) u.searchParams.set(key, "REDACTED");
    }
    return u.toString();
  } catch {
    return url;
  }
}

function backoffMs(attempt: number, retryAfterSec?: number): number {
  if (retryAfterSec != null && Number.isFinite(retryAfterSec)) {
    return Math.min(retryAfterSec * 1000, 60_000);
  }
  const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  // Full jitter: spreads retries so parallel callers do not resynchronise.
  return Math.random() * ceiling;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds)) return asSeconds;
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) {
    return Math.max(0, (asDate - Date.now()) / 1000);
  }
  return undefined;
}

async function attemptOnce<T>(
  url: string,
  opts: FetchJsonOptions<T>,
): Promise<T> {
  const { provider, schema, headers, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, timeoutSignal])
    : timeoutSignal;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json", ...headers },
      signal,
      cache: "no-store",
    });
  } catch (err) {
    if (timeoutSignal.aborted) {
      throw new ProviderError(
        `${provider}: request to ${redact(url)} timed out after ${timeoutMs}ms`,
        { provider, code: "timeout", cause: err },
      );
    }
    // Caller-initiated abort must propagate untouched.
    if (opts.signal?.aborted) throw err;
    throw new ProviderError(
      `${provider}: network error requesting ${redact(url)}`,
      { provider, code: "network", cause: err },
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProviderError(
      `${provider}: ${res.status} ${res.statusText} from ${redact(url)}${
        body ? ` — ${body.slice(0, 200)}` : ""
      }`,
      {
        provider,
        code: codeForStatus(res.status),
        status: res.status,
        retryAfter: parseRetryAfter(res.headers.get("retry-after")),
      },
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    // Truncated or malformed body — usually transient, so allow a retry.
    throw new ProviderError(
      `${provider}: malformed JSON from ${redact(url)}`,
      { provider, code: "invalid_response", retryable: true, cause: err },
    );
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    // The contract changed. Retrying cannot help.
    throw new ProviderError(
      `${provider}: unexpected response shape from ${redact(url)} — ${
        parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ") || "no detail"
      }`,
      { provider, code: "invalid_response", retryable: false },
    );
  }

  return parsed.data;
}

/** GET JSON with rate limiting, timeout, and retry on transient failures. */
export async function fetchJson<T>(
  url: string,
  opts: FetchJsonOptions<T>,
): Promise<T> {
  const retries = opts.retries ?? DEFAULT_RETRIES;

  for (let attempt = 0; ; attempt++) {
    if (opts.limiter) await opts.limiter.acquire();

    try {
      return await attemptOnce(url, opts);
    } catch (err) {
      const canRetry =
        attempt < retries && isProviderError(err) && err.retryable;
      if (!canRetry) throw err;

      await sleep(
        backoffMs(attempt + 1, isProviderError(err) ? err.retryAfter : undefined),
      );
    }
  }
}
