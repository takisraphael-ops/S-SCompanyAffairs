import { z } from "zod";
import type { AlertKind } from "@/db/schema";

/**
 * What each kind of alert watches, and what it needs to be told.
 *
 * One table rather than scattered constants, because three things have to
 * agree about every kind — the form that creates a rule, the sentence that
 * describes it afterwards, and the evaluator that fires it — and a kind added
 * to one but not the others fails silently. Adding an entry here is what
 * makes a new kind exist.
 */

/*
 * Messages are written for the person filling in the form, not for a log.
 * These are the only validation errors this app shows to someone who is not
 * debugging it, and zod's defaults ("Too small: expected number to be >0")
 * describe the check rather than what to do about it.
 */
const price = z.coerce
  .number({ error: "Enter a price, like 200" })
  .positive("A price has to be greater than zero")
  .finite();

const terms = z
  .array(z.string().trim().min(2).max(60))
  .min(1, "Enter at least one term to watch for")
  .max(20, "Twenty terms is the limit; split it into two alerts");

export const PARAM_SCHEMAS = {
  price_above: z.object({ threshold: price }),
  price_below: z.object({ threshold: price }),
  price_move: z.object({
    percent: z.coerce
      .number({ error: "Enter a percentage, like 5" })
      .positive("A percentage has to be greater than zero")
      .max(100, "A day move above 100% is not something to wait for"),
  }),
  new_filing: z.object({
    /** Empty means any form the app treats as material. */
    formTypes: z
      .array(z.string().trim().min(1).max(12))
      .max(10, "Ten form types is the limit")
      .default([]),
  }),
  material_news: z.object({
    minMateriality: z.coerce
      .number({ error: "Enter a score between 0 and 1, like 0.7" })
      .min(0, "The lowest score is 0")
      .max(1, "The highest score is 1"),
  }),
  keyword: z.object({ terms }),
  earnings_soon: z.object({
    days: z.coerce
      .number({ error: "Enter a number of days, like 7" })
      .int("Whole days only")
      .min(1, "At least one day ahead")
      .max(90, "Ninety days is the limit"),
  }),
} satisfies Record<AlertKind, z.ZodType>;

export type ParamsFor<K extends AlertKind> = z.infer<(typeof PARAM_SCHEMAS)[K]>;

/**
 * Condition rules describe a state and so must be edge-triggered; event rules
 * match a row that arrived and are deduplicated by that row's identity.
 *
 * The distinction decides whether `alert_states` is involved at all, which is
 * why it is declared rather than inferred from the kind at each call site.
 */
export const RULE_TRIGGER: Record<AlertKind, "condition" | "event"> = {
  price_above: "condition",
  price_below: "condition",
  price_move: "condition",
  earnings_soon: "condition",
  new_filing: "event",
  material_news: "event",
  keyword: "event",
};

export interface KindInfo {
  label: string;
  /** What it does, in the words someone choosing it would use. */
  hint: string;
  /** Concept slug explaining the underlying idea, where P1 authored one. */
  concept?: string;
}

export const KIND_INFO: Record<AlertKind, KindInfo> = {
  price_above: {
    label: "Price rises above",
    hint: "Fires once when the price crosses your level, not every time it is above it.",
    concept: "price",
  },
  price_below: {
    label: "Price falls below",
    hint: "The same, downward. Useful for a level you decided on in advance rather than in the moment.",
    concept: "price",
  },
  price_move: {
    label: "Day change beyond",
    hint: "Fires on a move of this size in either direction on the day.",
    concept: "percent-change",
  },
  new_filing: {
    label: "New SEC filing",
    hint: "Fires when a filing appears. Leave the form types empty for anything material.",
    concept: "sec-edgar",
  },
  material_news: {
    label: "Material news",
    hint: "Fires on an article scoring at or above this materiality — the same score that ranks the feed.",
    concept: "guidance",
  },
  keyword: {
    label: "Headline mentions",
    hint: "Fires when a headline or snippet contains any of these terms.",
  },
  earnings_soon: {
    label: "Earnings coming up",
    hint: "Fires once when a scheduled earnings date comes within this many days.",
    concept: "earnings-call",
  },
};

export class InvalidRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRuleError";
  }
}

/**
 * Parse a rule's stored parameters, or refuse.
 *
 * Applied on the way in *and* on the way out. On the way in because a form
 * field is not a safe thing to put in a jsonb column; on the way out because
 * the column is jsonb and nothing stops an older row, or a hand-edited one,
 * from holding a shape this code no longer understands. A rule that cannot be
 * parsed is skipped and reported rather than evaluated against a guess.
 */
export function parseParams<K extends AlertKind>(
  kind: K,
  raw: unknown,
): ParamsFor<K> {
  const schema = PARAM_SCHEMAS[kind];
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    // The messages above are already sentences, so they are joined as prose
    // rather than annotated with the field path — which the form makes
    // obvious anyway, since there is one field per kind.
    throw new InvalidRuleError(
      parsed.error.issues.map((i) => i.message).join(". "),
    );
  }
  return parsed.data as ParamsFor<K>;
}

/** The rule as a sentence, for the alerts list. */
export function describeRule(
  kind: AlertKind,
  rawParams: unknown,
  scope: string,
): string {
  let params: Record<string, unknown>;
  try {
    params = parseParams(kind, rawParams) as Record<string, unknown>;
  } catch {
    return `${scope} — this rule's settings could not be read`;
  }

  switch (kind) {
    case "price_above":
      return `${scope} rises above $${params.threshold}`;
    case "price_below":
      return `${scope} falls below $${params.threshold}`;
    case "price_move":
      return `${scope} moves more than ${params.percent}% in a day`;
    case "new_filing": {
      const forms = params.formTypes as string[];
      return forms.length
        ? `${scope} files a ${forms.join(" or ")}`
        : `${scope} files anything material`;
    }
    case "material_news":
      return `${scope} has news scoring ${params.minMateriality} or above`;
    case "keyword":
      return `${scope} is in a headline mentioning ${(params.terms as string[])
        .map((t) => `“${t}”`)
        .join(", ")}`;
    case "earnings_soon":
      return `${scope} reports earnings within ${params.days} days`;
  }
}
