import Anthropic from "@anthropic-ai/sdk";
import { ProviderError } from "../errors";
import type { LlmProvider, LlmRequest, LlmResult } from "../types";

const PROVIDER = "anthropic";

export interface AnthropicModels {
  /** High volume, mechanical: paraphrase what a document already says. */
  fast: string;
  /** Low volume, contextual: reason about a company's figures. */
  careful: string;
}

/**
 * Text generation via the Claude API.
 *
 * Two things about this adapter are deliberate.
 *
 * **The system prompt is sent as a cacheable block.** Every call of a given
 * kind sends the same instructions and a small variable payload, which is the
 * shape prompt caching exists for. It only pays off above the model's minimum
 * cacheable length, so it is a hint rather than a guarantee — but the caller
 * is already structured to make it possible (see src/ai/prompts.ts), and
 * nothing is lost when it does not apply.
 *
 * **Neither `thinking` nor `output_config` is sent.** The accepted shape of
 * both differs across model generations — `budget_tokens` is rejected by
 * newer models, `effort` is unsupported by older ones — and the model here is
 * whatever string the operator configured. Sending neither leaves each model
 * at its own default, which is the only choice that stays correct when the
 * configured model changes. Brevity is a prompt constraint instead, and a
 * truncated response is caught below rather than stored.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = PROVIDER;

  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly models: AnthropicModels,
  ) {
    this.client = new Anthropic({
      apiKey,
      // The SDK's own backoff. Ingest already retries at the job level, but
      // a 429 mid-batch is better absorbed here than by re-running the batch.
      maxRetries: 3,
      timeout: 120_000,
    });
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const model = req.tier === "fast" ? this.models.fast : this.models.careful;

    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model,
        max_tokens: req.maxTokens,
        system: [
          {
            type: "text",
            text: req.system,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: req.user }],
      });
    } catch (err) {
      throw toProviderError(err, `${model} (${req.kind}: ${req.subject})`);
    }

    // Checked before reading content: a refusal still returns a well-formed
    // response, and its text is an apology, not a summary. Storing that in
    // the cache would put "I can't help with that" on the company page and
    // suppress every later attempt.
    if (message.stop_reason === "refusal") {
      const detail = message.stop_details?.explanation ?? "no explanation given";
      throw new ProviderError(`${model} declined to answer: ${detail}`, {
        provider: PROVIDER,
        code: "refused",
        retryable: false,
      });
    }

    if (message.stop_reason === "max_tokens") {
      throw new ProviderError(
        `${model} hit the ${req.maxTokens}-token ceiling before finishing`,
        { provider: PROVIDER, code: "invalid_response", retryable: false },
      );
    }

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!text) {
      throw new ProviderError(`${model} returned no text`, {
        provider: PROVIDER,
        code: "invalid_response",
        retryable: false,
      });
    }

    return {
      text,
      model: message.model,
      // Cache reads and writes are input tokens too; counting only the
      // uncached ones would make a well-cached job look free.
      inputTokens:
        message.usage.input_tokens +
        (message.usage.cache_read_input_tokens ?? 0) +
        (message.usage.cache_creation_input_tokens ?? 0),
      outputTokens: message.usage.output_tokens,
    };
  }
}

/**
 * The SDK's typed error classes, narrowed to our own codes.
 *
 * Matched by class rather than by message text or status number, because the
 * SDK is the thing that knows which is which.
 */
function toProviderError(err: unknown, context: string): ProviderError {
  const opts = { provider: PROVIDER, cause: err };
  const where = `${context}: `;

  if (err instanceof Anthropic.RateLimitError) {
    return new ProviderError(`${where}rate limited`, {
      ...opts,
      code: "rate_limited",
      status: err.status,
    });
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new ProviderError(`${where}ANTHROPIC_API_KEY was rejected`, {
      ...opts,
      code: "unauthorized",
      status: err.status,
    });
  }
  if (err instanceof Anthropic.NotFoundError) {
    // Almost always a model string that does not exist, so say so.
    return new ProviderError(`${where}no such model, or endpoint not found`, {
      ...opts,
      code: "not_found",
      status: err.status,
    });
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new ProviderError(`${where}${err.message}`, {
      ...opts,
      code: "invalid_response",
      status: err.status,
    });
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError(`${where}timed out`, { ...opts, code: "timeout" });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError(`${where}connection failed`, {
      ...opts,
      code: "network",
    });
  }
  if (err instanceof Anthropic.APIError) {
    return new ProviderError(`${where}${err.message}`, {
      ...opts,
      code: (err.status ?? 0) >= 500 ? "upstream" : "invalid_response",
      status: err.status,
    });
  }
  return new ProviderError(`${where}${String(err)}`, {
    ...opts,
    code: "upstream",
  });
}
