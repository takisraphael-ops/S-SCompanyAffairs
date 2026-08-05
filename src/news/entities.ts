import type { LinkMethod } from "@/db/schema";

/**
 * Deciding which companies an article is actually about.
 *
 * This is the hard half of news (docs/PLAN.md §4). The failure mode that
 * matters is the false positive: "Apple", "Target", "Visa", "Block", "Match",
 * "Gap", "Shell" and "Unity" are ordinary English words, and matching them
 * naively fills a watchlist with articles about fruit and clothing.
 *
 * The design assumption that makes this tractable: the *primary* link comes
 * from how the article was fetched, not from its text. Feeds are pulled
 * per-security, so we already know who the article is about. Text matching
 * exists to find mentions of *other* watchlist companies — and since a wrong
 * cross-link is worse than a missed one, the rules below are deliberately
 * conservative.
 */

export interface EntityCandidate {
  securityId: string;
  ticker: string;
  name: string;
  aliases: string[];
}

export interface EntityMatch {
  securityId: string;
  relevance: number;
  method: LinkMethod;
}

/** Links below this are not worth storing. */
export const RELEVANCE_THRESHOLD = 0.5;

const CORPORATE_SUFFIX_WORDS = [
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "limited",
  "plc",
  "llc",
  "holdings",
  "group",
  "technologies",
  "systems",
];

/**
 * Single-word company names that collide with ordinary English. A match on
 * one of these means nothing without corroboration.
 *
 * Not exhaustive by design — the rule below also demotes single-token matches
 * generally, so an unlisted collision is degraded rather than trusted.
 */
const COMMON_WORDS = new Set([
  "apple", "target", "visa", "block", "match", "gap", "shell", "unity",
  "zoom", "snap", "square", "oracle", "amazon", "sun", "boot", "dollar",
  "general", "national", "first", "united", "american", "open", "public",
  "sound", "spring", "summit", "core", "edge", "pulse", "signal", "vector",
  "arch", "atlas", "aurora", "beacon", "bridge", "chase", "crown", "dover",
  "eagle", "element", "energy", "equity", "essential", "focus", "global",
  "grid", "harmony", "haven", "horizon", "insight", "legacy", "liberty",
  "marathon", "mercury", "meta", "monster", "nature", "nike", "north",
  "novel", "orange", "origin", "paycom", "pioneer", "premier", "prime",
  "progress", "quest", "range", "regal", "royal", "sage", "select",
  "sierra", "stride", "summit", "tempo", "titan", "trust", "union",
  "vantage", "verve", "vista", "wave", "west", "wind",
]);

/**
 * Short tickers that are also common words or abbreviations. Length alone
 * handles most of this (see below); these are the longer offenders.
 */
const AMBIGUOUS_TICKERS = new Set([
  "ALL", "ARE", "CAR", "CEO", "EAT", "FAST", "FUN", "GOOD", "HAS", "HOME",
  "HUGE", "ICE", "JOB", "KEY", "LAND", "LIFE", "LOVE", "MAN", "NEW", "NOW",
  "ONE", "OPEN", "OUT", "PLAN", "PLAY", "REAL", "RUN", "SAFE", "SEE", "SUN",
  "TEAM", "TRUE", "TRY", "TWO", "WELL", "WORK", "USA", "GAAP", "CFO", "IPO",
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Company name with legal suffixes and punctuation removed. */
export function stripCorporateSuffix(name: string): string {
  const pattern = new RegExp(
    `[,\\s]+(${CORPORATE_SUFFIX_WORDS.join("|")})\\.?$`,
    "i",
  );

  let out = name.trim();
  // Repeat: "Alphabet Inc. Class A Holdings" sheds one suffix at a time.
  for (let i = 0; i < 3; i++) {
    const next = out.replace(pattern, "").trim();
    if (next === out) break;
    out = next;
  }
  return out.replace(/[.,]+$/, "").trim();
}

/** `$AAPL` — an explicit cashtag, unambiguous by construction. */
function hasCashtag(text: string, ticker: string): boolean {
  return new RegExp(`\\$${escapeRegex(ticker)}\\b`, "i").test(text);
}

/**
 * Bare `AAPL` on a word boundary, case-sensitively uppercase.
 *
 * Tickers of one or two characters are ignored without a `$` prefix: "GO",
 * "IT" and "ON" appear in ordinary prose constantly, and no amount of
 * boundary matching rescues them.
 */
function hasBareTicker(text: string, ticker: string): boolean {
  if (ticker.length <= 2) return false;
  if (AMBIGUOUS_TICKERS.has(ticker)) return false;
  return new RegExp(`\\b${escapeRegex(ticker)}\\b`).test(text);
}

/** Whether `phrase` appears followed by a legal suffix, e.g. "Apple Inc". */
function followedByCorporateSuffix(text: string, phrase: string): boolean {
  return new RegExp(
    `\\b${escapeRegex(phrase)}(?:'s)?[,\\s]+(${CORPORATE_SUFFIX_WORDS.join("|")})\\b`,
    "i",
  ).test(text);
}

function containsPhrase(text: string, phrase: string): boolean {
  return new RegExp(`\\b${escapeRegex(phrase)}(?:'s)?\\b`, "i").test(text);
}

/**
 * Score a name or alias match.
 *
 * Multi-word names are safe: "Advanced Micro Devices" is not going to appear
 * by accident. Single words are not, so they need a second signal — a legal
 * suffix beside them, the ticker elsewhere in the text, or at minimum not
 * being an ordinary English word.
 */
function scorePhrase(
  text: string,
  phrase: string,
  ticker: string,
  isAlias: boolean,
): number {
  if (!phrase || !containsPhrase(text, phrase)) return 0;

  const multiWord = phrase.trim().includes(" ");
  if (multiWord) return isAlias ? 0.8 : 0.85;

  if (followedByCorporateSuffix(text, phrase)) return 0.85;
  if (hasCashtag(text, ticker) || hasBareTicker(text, ticker)) return 0.8;
  if (!COMMON_WORDS.has(phrase.toLowerCase())) return isAlias ? 0.6 : 0.65;

  // A bare common word. Recorded as a weak signal and dropped by the
  // threshold unless something else corroborates it.
  return 0.35;
}

export interface ResolveOptions {
  /**
   * The security whose feed produced this article. Fetching is per-security,
   * so this is the strongest signal available and does not depend on text.
   */
  fetchedForSecurityId?: string;
  /** Tickers the provider itself tagged the article with. */
  providerTickers?: string[];
}

/**
 * Resolve an article to the securities it concerns.
 *
 * Returns at most one match per security — the highest-scoring method — and
 * only those at or above RELEVANCE_THRESHOLD.
 */
export function resolveEntities(
  input: { title: string; snippet?: string | null },
  candidates: EntityCandidate[],
  options: ResolveOptions = {},
): EntityMatch[] {
  const text = [input.title, input.snippet ?? ""].join(" \n ");
  const providerTickers = new Set(
    (options.providerTickers ?? []).map((t) => t.toUpperCase()),
  );

  const best = new Map<string, EntityMatch>();
  const consider = (m: EntityMatch) => {
    const existing = best.get(m.securityId);
    if (!existing || m.relevance > existing.relevance) best.set(m.securityId, m);
  };

  for (const candidate of candidates) {
    if (candidate.securityId === options.fetchedForSecurityId) {
      consider({
        securityId: candidate.securityId,
        relevance: 0.95,
        method: "feed_query",
      });
    }

    if (providerTickers.has(candidate.ticker.toUpperCase())) {
      consider({
        securityId: candidate.securityId,
        relevance: 0.9,
        method: "provider_tag",
      });
    }

    if (hasCashtag(text, candidate.ticker)) {
      consider({
        securityId: candidate.securityId,
        relevance: 0.9,
        method: "ticker",
      });
    } else if (hasBareTicker(text, candidate.ticker)) {
      consider({
        securityId: candidate.securityId,
        relevance: 0.7,
        method: "ticker",
      });
    }

    const shortName = stripCorporateSuffix(candidate.name);
    const nameScore = scorePhrase(text, shortName, candidate.ticker, false);
    if (nameScore > 0) {
      consider({
        securityId: candidate.securityId,
        relevance: nameScore,
        method: "name",
      });
    }

    for (const alias of candidate.aliases) {
      const aliasScore = scorePhrase(text, alias, candidate.ticker, true);
      if (aliasScore > 0) {
        consider({
          securityId: candidate.securityId,
          relevance: aliasScore,
          method: "alias",
        });
      }
    }
  }

  return [...best.values()]
    .filter((m) => m.relevance >= RELEVANCE_THRESHOLD)
    .sort((a, b) => b.relevance - a.relevance);
}
