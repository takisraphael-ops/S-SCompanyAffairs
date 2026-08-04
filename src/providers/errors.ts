export type ProviderErrorCode =
  | "rate_limited"
  | "unauthorized"
  | "not_found"
  | "unsupported"
  | "invalid_response"
  | "timeout"
  | "network"
  | "upstream";

/**
 * A failure attributable to an upstream data provider.
 *
 * `retryable` is decided here, at the point where we know the provider's
 * semantics, rather than inferred later from a status code.
 */
export class ProviderError extends Error {
  readonly provider: string;
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly retryable: boolean;
  /** Seconds the provider asked us to wait, from Retry-After. */
  readonly retryAfter?: number;

  constructor(
    message: string,
    opts: {
      provider: string;
      code: ProviderErrorCode;
      status?: number;
      retryable?: boolean;
      retryAfter?: number;
      cause?: unknown;
    },
  ) {
    super(message, { cause: opts.cause });
    this.name = "ProviderError";
    this.provider = opts.provider;
    this.code = opts.code;
    this.status = opts.status;
    this.retryAfter = opts.retryAfter;
    this.retryable = opts.retryable ?? defaultRetryable(opts.code);
  }
}

function defaultRetryable(code: ProviderErrorCode): boolean {
  switch (code) {
    case "rate_limited":
    case "timeout":
    case "network":
    case "upstream":
      return true;
    default:
      return false;
  }
}

export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError;
}

/** Map an HTTP status to a provider error code. */
export function codeForStatus(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "upstream";
  return "invalid_response";
}
