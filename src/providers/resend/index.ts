import { z } from "zod";
import { ProviderError } from "../errors";
import { fetchJson } from "../http";
import { RateLimiter } from "../rate-limit";
import type { Notification, Notifier } from "../types";

const ENDPOINT = "https://api.resend.com/emails";
const PROVIDER = "resend";

/** Resend documents 2 requests per second on the free tier. */
const limiter = new RateLimiter(4, 2);

const sendResponse = z.object({ id: z.string() });

/**
 * Email via Resend.
 *
 * Chosen for the same reason as every other provider here: a free tier that
 * covers personal use (3,000 messages a month), no SDK needed, and one POST
 * to send. It sits behind `Notifier`, so replacing it with Postmark or SES is
 * an adapter and a case in the registry.
 *
 * The `Idempotency-Key` header is not optional decoration. `fetchJson` retries
 * a timeout, and a timed-out send is the case where the message most likely
 * *did* arrive — without the key, every slow response would be a duplicate
 * email. The key comes from the caller and is derived from the row being
 * delivered, so it is stable across retries and across process restarts.
 */
export class ResendNotifier implements Notifier {
  readonly name = PROVIDER;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly to: string,
  ) {}

  async send(message: Notification): Promise<void> {
    await fetchJson(ENDPOINT, {
      provider: PROVIDER,
      schema: sendResponse,
      method: "POST",
      limiter,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "idempotency-key": message.idempotencyKey,
      },
      body: {
        from: this.from,
        to: [this.to],
        subject: message.subject,
        // Sent as text rather than HTML. The content is short markdown about
        // money; an HTML template would be a second thing to maintain and a
        // second place for the numbers to be wrong.
        text: message.body,
      },
    }).catch((err) => {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(`${PROVIDER}: ${String(err)}`, {
        provider: PROVIDER,
        code: "upstream",
        cause: err,
      });
    });
  }
}
