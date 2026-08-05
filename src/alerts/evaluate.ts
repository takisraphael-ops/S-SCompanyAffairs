import type { AlertKind } from "@/db/schema";
import { describeForm, isMaterialForm } from "@/lib/forms";
import { parseParams } from "./rules";

/**
 * Deciding whether a rule fires, as pure functions.
 *
 * Nothing here reads the database or the clock — the caller supplies both —
 * so every branch is reachable from a unit test. That matters more for this
 * module than for most: an alert that fires when it should not is noticed
 * immediately and an alert that does not fire when it should is never
 * noticed at all, and the second is only catchable by testing it.
 */

export interface Firing {
  /**
   * Identifies what fired, such that a repeat of the same news produces the
   * same string. `alert_events` has a unique index on (rule, key).
   */
  dedupeKey: string;
  title: string;
  body: string;
  url: string | null;
  payload: Record<string, unknown>;
}

export interface SecurityRef {
  id: string;
  ticker: string;
  name: string;
}

/* ------------------------------------------------------------------ *
 * Condition rules
 * ------------------------------------------------------------------ */

export interface ConditionInput {
  security: SecurityRef;
  price: number | null;
  changePct: number | null;
  /** The next scheduled earnings date, if one is stored. */
  nextEarningsAt: Date | null;
  now: Date;
}

export interface ConditionResult {
  /** Whether the condition is true right now, regardless of arming. */
  holds: boolean;
  /** What to say if it fires. Absent when the condition does not hold. */
  firing?: Firing;
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Evaluate a state-shaped rule.
 *
 * Returns whether the condition holds; it does *not* decide whether to fire.
 * That decision needs the previous evaluation's answer, which lives in
 * `alert_states`, and keeping the two apart is what lets this be pure.
 *
 * A note on the dedupe keys below: they carry the date. Arming already
 * guarantees one firing per crossing, so this is the second line of defence —
 * and where the two disagree, the date wins, deliberately. A price that
 * crosses $200, falls back and crosses again before the close is one piece of
 * news, and the second notification is the kind of noise that gets alerting
 * switched off.
 */
export function evaluateCondition(
  kind: AlertKind,
  rawParams: unknown,
  input: ConditionInput,
): ConditionResult {
  const { security, price, changePct, now } = input;
  const who = `${security.ticker}`;
  const companyUrl = `/company/${security.ticker}`;

  switch (kind) {
    case "price_above": {
      const { threshold } = parseParams("price_above", rawParams);
      if (price === null || price <= threshold) return { holds: false };
      return {
        holds: true,
        firing: {
          dedupeKey: `above:${threshold}:${day(now)}`,
          title: `${who} above $${threshold}`,
          body: `${security.name} is trading at $${price.toFixed(2)}, above the $${threshold} level you set.`,
          url: companyUrl,
          payload: { price, threshold },
        },
      };
    }

    case "price_below": {
      const { threshold } = parseParams("price_below", rawParams);
      if (price === null || price >= threshold) return { holds: false };
      return {
        holds: true,
        firing: {
          dedupeKey: `below:${threshold}:${day(now)}`,
          title: `${who} below $${threshold}`,
          body: `${security.name} is trading at $${price.toFixed(2)}, below the $${threshold} level you set.`,
          url: companyUrl,
          payload: { price, threshold },
        },
      };
    }

    case "price_move": {
      const { percent } = parseParams("price_move", rawParams);
      if (changePct === null || Math.abs(changePct) < percent) {
        return { holds: false };
      }
      // Direction is in the key, so a stock that falls 6% and then recovers
      // to +6% on the same day is two pieces of news, not one.
      const direction = changePct > 0 ? "up" : "down";
      return {
        holds: true,
        firing: {
          dedupeKey: `move:${direction}:${percent}:${day(now)}`,
          title: `${who} ${direction} ${Math.abs(changePct).toFixed(1)}%`,
          body: `${security.name} is ${direction} ${Math.abs(changePct).toFixed(2)}% on the day, past the ${percent}% you asked about.`,
          url: companyUrl,
          payload: { changePct, percent, direction },
        },
      };
    }

    case "earnings_soon": {
      const { days } = parseParams("earnings_soon", rawParams);
      const at = input.nextEarningsAt;
      if (!at) return { holds: false };

      const daysAway = Math.ceil((at.getTime() - now.getTime()) / 86_400_000);
      if (daysAway < 0 || daysAway > days) return { holds: false };

      return {
        holds: true,
        firing: {
          // The earnings date itself, so one notification per event however
          // often the job runs in the window before it.
          dedupeKey: `earnings:${day(at)}`,
          title: `${who} reports in ${daysAway} ${daysAway === 1 ? "day" : "days"}`,
          body: `${security.name} is scheduled to report on ${day(at)}.`,
          url: companyUrl,
          payload: { scheduledAt: at.toISOString(), daysAway },
        },
      };
    }

    default:
      return { holds: false };
  }
}

/* ------------------------------------------------------------------ *
 * Event rules
 * ------------------------------------------------------------------ */

export interface CandidateArticle {
  id: string;
  title: string;
  snippet: string | null;
  url: string;
  materiality: number;
  publishedAt: Date;
}

export interface CandidateFiling {
  id: string;
  formType: string;
  filedAt: Date;
  url: string;
}

/**
 * Whether a term occurs in a piece of text.
 *
 * Word boundaries, not substring: "AI" must not match "said", and "chip" must
 * not match "shipping". A multi-word term is matched as a phrase with
 * flexible whitespace, so "supply agreement" survives a line break in a
 * snippet. The term is escaped before it reaches the pattern — these strings
 * come from a form, and a stray `(` would otherwise throw.
 */
export function matchesTerm(text: string, term: string): boolean {
  const escaped = term
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  if (!escaped) return false;

  // \b does not apply to a term starting or ending in punctuation ("$AAPL"),
  // so the boundary is asserted only where the adjacent character is a word
  // character in the term itself.
  const left = /^\w/.test(term.trim()) ? "\\b" : "";
  const right = /\w$/.test(term.trim()) ? "\\b" : "";
  return new RegExp(`${left}${escaped}${right}`, "i").test(text);
}

export function matchArticle(
  kind: AlertKind,
  rawParams: unknown,
  article: CandidateArticle,
  security: SecurityRef,
): Firing | null {
  switch (kind) {
    case "material_news": {
      const { minMateriality } = parseParams("material_news", rawParams);
      if (article.materiality < minMateriality) return null;
      return {
        dedupeKey: `article:${article.id}`,
        title: `${security.ticker}: ${article.title}`,
        body:
          article.snippet ??
          `Scored ${article.materiality.toFixed(2)} for materiality.`,
        url: article.url,
        payload: { articleId: article.id, materiality: article.materiality },
      };
    }

    case "keyword": {
      const { terms } = parseParams("keyword", rawParams);
      const haystack = `${article.title}\n${article.snippet ?? ""}`;
      const hit = terms.find((t) => matchesTerm(haystack, t));
      if (!hit) return null;
      return {
        dedupeKey: `article:${article.id}`,
        title: `${security.ticker}: ${article.title}`,
        body: `Matched “${hit}”. ${article.snippet ?? ""}`.trim(),
        url: article.url,
        payload: { articleId: article.id, term: hit },
      };
    }

    default:
      return null;
  }
}

export function matchFiling(
  kind: AlertKind,
  rawParams: unknown,
  filing: CandidateFiling,
  security: SecurityRef,
): Firing | null {
  if (kind !== "new_filing") return null;

  const { formTypes } = parseParams("new_filing", rawParams);
  const wanted = formTypes.map((f) => f.trim().toUpperCase());
  const form = filing.formType.toUpperCase();

  // An empty list means "anything material" rather than "everything": a
  // watchlist of ten companies files dozens of insider Form 4s a month, and
  // an alert that fires on all of them is one nobody reads.
  const matches = wanted.length ? wanted.includes(form) : isMaterialForm(form);
  if (!matches) return null;

  const info = describeForm(filing.formType);
  return {
    dedupeKey: `filing:${filing.id}`,
    title: `${security.ticker} filed a ${filing.formType}`,
    body: `${info.label}. ${info.description}`,
    url: filing.url,
    payload: { filingId: filing.id, formType: filing.formType },
  };
}
