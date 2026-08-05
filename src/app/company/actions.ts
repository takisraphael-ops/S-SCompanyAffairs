"use server";

import { METRIC_KEYS } from "@/lib/metrics";
import { isProviderError } from "@/providers/errors";
import { explainMetric, readMetricExplanation } from "@/services/ai";
import type { ExplainState } from "@/lib/explain-state";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Explain one figure, on request.
 *
 * The only path in the app that can cause an API call from a user action, and
 * it is a click rather than a render — which is what keeps the P0 rule intact
 * while still making the explanation feel immediate. A figure already
 * explained comes back from the cache without a call.
 *
 * Both inputs are validated against closed sets before reaching SQL or a
 * prompt: the metric against METRIC_KEYS, the security against a uuid shape.
 * A form field is not a safe thing to interpolate into either.
 */
export async function explainMetricAction(
  _prev: ExplainState,
  formData: FormData,
): Promise<ExplainState> {
  const securityId = String(formData.get("securityId") ?? "");
  const metricKey = String(formData.get("metricKey") ?? "");
  const force = String(formData.get("force") ?? "") === "true";

  if (!UUID_RE.test(securityId)) {
    return { status: "error", message: "Unknown company." };
  }
  if (!(METRIC_KEYS as readonly string[]).includes(metricKey)) {
    return { status: "error", message: "Unknown figure." };
  }

  try {
    /*
     * A cached answer is returned without generating — unless the caller
     * asked for a fresh one, the figures have moved since, or it is
     * placeholder text written before a key was configured. That last case
     * is the reason this is not just a hash comparison: the prompt did not
     * change, so nothing about the stored row looks wrong, but "no API key
     * is configured" is not an explanation of a P/E ratio.
     */
    if (!force) {
      const existing = await readMetricExplanation(securityId, metricKey);
      if (existing && !existing.stale && !existing.superseded) {
        return {
          status: "ready",
          body: existing.body,
          model: existing.model,
          stale: false,
        };
      }
    }

    const result = await explainMetric(securityId, metricKey, { force });
    if (!result) {
      return {
        status: "error",
        message: "Nothing stored for that figure yet.",
      };
    }

    return {
      status: "ready",
      body: result.body,
      model: result.model,
      stale: false,
    };
  } catch (err) {
    // Surfaced rather than swallowed: a rejected key, a rate limit and a
    // refusal are all things the reader can act on, and a silent empty panel
    // is indistinguishable from a broken button.
    const message = isProviderError(err)
      ? err.code === "unauthorized"
        ? "The configured API key was rejected."
        : err.code === "rate_limited"
          ? "Rate limited. Try again shortly."
          : err.code === "refused"
            ? "The model declined to answer this one."
            : err.message
      : err instanceof Error
        ? err.message
        : "Could not generate an explanation.";

    return { status: "error", message };
  }
}
