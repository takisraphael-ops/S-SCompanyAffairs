import type { ConceptLevel, EventType, GenerationKind } from "@/db/schema";
import { EVENT_LABEL } from "@/news/classify";

/**
 * Every prompt the app sends, as pure functions of stored data.
 *
 * Two properties are load-bearing.
 *
 * **Nothing is fetched here.** A builder takes rows the caller already read
 * out of Postgres and returns strings. That keeps the P0 rule intact — no
 * third-party call during a page render — and it means a prompt can be
 * inspected in a unit test without a database or a network.
 *
 * **The prompt is the cache key.** `src/ai/cache.ts` hashes exactly these
 * strings, so the key cannot drift from what was actually sent. Anything that
 * should invalidate a cached answer has to appear in the prompt, and anything
 * that appears in the prompt does invalidate it. That is why a formatted
 * figure goes in rather than a raw float: what the model saw is what the
 * reader saw, and a change of either regenerates.
 */

export interface PromptSpec {
  kind: GenerationKind;
  /** One line naming the subject, for logs and for the mock adapter. */
  subject: string;
  system: string;
  user: string;
}

/**
 * Constraints shared by everything generated here.
 *
 * The first two are the ones that matter. **Grounding**: this app's whole
 * claim is that a figure and its explanation cannot disagree, which fails the
 * moment a model supplies a number of its own. **No advice**: it is a
 * research and learning tool, it does not know the reader's circumstances,
 * and a summary that drifts into "this looks cheap" is worse than no summary.
 *
 * Sent as one block per kind so it is a stable prefix the provider can cache.
 */
const HOUSE_RULES = [
  "You write for a personal stock-research dashboard whose purpose is to teach.",
  "",
  "Rules, in order of importance:",
  "",
  "1. Use only the figures and facts given to you below. Never introduce a",
  "   number, date, percentage or comparison that is not in the input — not",
  "   from memory, not as an estimate, not as a round figure. If something",
  "   needed to answer well is missing, say plainly that it is not available.",
  "2. Never give investment advice. Do not say whether anything is cheap,",
  "   expensive, a good buy, undervalued or overvalued, and do not predict a",
  "   price or an outcome. Explain what the reader is looking at and what",
  "   would ordinarily cause it; leave the judgement to them.",
  "3. Write plain English. Explain jargon the first time it appears rather",
  "   than assuming it. The reader may be new to all of this.",
  "4. No preamble, no sign-off, no headings, no bullet lists unless asked.",
  "   Start with the substance. Plain prose paragraphs only.",
].join("\n");

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * Story summaries
 * ------------------------------------------------------------------ */

export interface StorySummaryInput {
  /** Companies the story was linked to, for naming rather than for facts. */
  companies: Array<{ ticker: string; name: string }>;
  eventType: EventType;
  articles: Array<{
    title: string;
    publisher: string | null;
    sourceName: string;
    publishedAt: Date;
    snippet: string | null;
  }>;
}

const STORY_SYSTEM = [
  HOUSE_RULES,
  "",
  "You are given every headline that was clustered as one story: several",
  "outlets carrying the same underlying event. Say in two or three sentences",
  "what happened, so a reader can decide whether to open any of them.",
  "",
  "You have the headlines and snippets, not the articles. Do not state",
  "details that only the full text would contain. Where the headlines",
  "disagree, or where they assert something without support, say so — that",
  "disagreement is itself the most useful thing you can report.",
].join("\n");

export function storySummaryPrompt(input: StorySummaryInput): PromptSpec {
  const who = input.companies
    .map((c) => `${c.name} (${c.ticker})`)
    .join(", ");

  const lines: string[] = [
    `Companies: ${who || "not linked to a watchlist company"}`,
    `Classified as: ${EVENT_LABEL[input.eventType]}`,
    `Coverage: ${input.articles.length} article${input.articles.length === 1 ? "" : "s"}`,
    "",
  ];

  input.articles.forEach((a, i) => {
    lines.push(`--- Article ${i + 1} ---`);
    lines.push(`Headline: ${a.title}`);
    lines.push(
      `Source: ${a.publisher ?? a.sourceName}, published ${isoDate(a.publishedAt)}`,
    );
    if (a.snippet) lines.push(`Snippet: ${a.snippet}`);
    lines.push("");
  });

  return {
    kind: "story_summary",
    subject: `${input.companies[0]?.ticker ?? "unlinked"} · ${input.articles[0]?.title ?? "story"}`,
    system: STORY_SYSTEM,
    user: lines.join("\n").trimEnd(),
  };
}

/* ------------------------------------------------------------------ *
 * Filing summaries
 * ------------------------------------------------------------------ */

export interface FilingSummaryInput {
  ticker: string;
  companyName: string;
  formType: string;
  filedAt: Date;
  /** SEC's own description of the primary document, when it supplies one. */
  description: string | null;
}

/**
 * Note what this deliberately does not do: read the filing.
 *
 * Fetching and summarising the document itself is a different and much larger
 * problem — a 10-K runs to a hundred pages and would have to be chunked,
 * which is a phase of its own rather than a paragraph. What a reader is
 * actually missing in front of a list of form codes is what "8-K" means and
 * why a company files one, and that is answerable from the form type alone.
 *
 * The prompt is explicit about the limit so the model does not paper over it,
 * and the UI says the same thing beside the output.
 */
const FILING_SYSTEM = [
  HOUSE_RULES,
  "",
  "You are given the metadata of one SEC filing: the form type, who filed it",
  "and when. You have NOT read the document.",
  "",
  "In two or three sentences, tell the reader what this form is for, what a",
  "company is required to disclose in it, and what filing one at this time",
  "ordinarily indicates. Never state what this particular document says.",
  "Where the reader would have to open it to learn something, say so.",
].join("\n");

export function filingSummaryPrompt(input: FilingSummaryInput): PromptSpec {
  const lines = [
    `Company: ${input.companyName} (${input.ticker})`,
    `Form type: ${input.formType}`,
    `Filed: ${isoDate(input.filedAt)}`,
  ];
  if (input.description) {
    lines.push(`SEC's description of the primary document: ${input.description}`);
  }

  return {
    kind: "filing_summary",
    subject: `${input.ticker} · ${input.formType} filed ${isoDate(input.filedAt)}`,
    system: FILING_SYSTEM,
    user: lines.join("\n"),
  };
}

/* ------------------------------------------------------------------ *
 * Contextual metric explanations
 * ------------------------------------------------------------------ */

export interface MetricExplanationInput {
  ticker: string;
  companyName: string;
  industry: string | null;
  metricKey: string;
  /** The concept's term, e.g. "P/E ratio". */
  term: string;
  /** The authored one-liner. Supplied so the model does not repeat it. */
  oneLiner: string;
  /** As rendered on the page, units and all. */
  formatted: string;
  origin: "reported" | "derived";
  periodEnd: Date;
  periodType: string;
  /** Every other figure from the same period, so context is available. */
  context: Array<{ metricKey: string; formatted: string }>;
  /** This metric's own history, oldest first. */
  history: Array<{ periodEnd: Date; formatted: string }>;
  /** The reader's setting, which decides how much is assumed. */
  level: ConceptLevel;
}

const LEVEL_GUIDANCE: Record<ConceptLevel, string> = {
  beginner:
    "The reader is new to this. Assume no prior knowledge, spell out what " +
    "the figure is counting, and prefer a concrete comparison over a term.",
  intermediate:
    "The reader knows the common terms. Skip the basics and spend the words " +
    "on what is specific to this company's figure.",
  advanced:
    "The reader is fluent. Be direct and dense; go straight to what is " +
    "unusual about this figure and what would explain it.",
};

/**
 * The generation the phase exists for, and the second half of the design in
 * docs/PLAN.md §3.
 *
 * The static concept already answers "what is a P/E ratio", authored once and
 * shown for free on hover. It cannot answer "why is *this* company's 47",
 * because that depends on figures that change. So the authored one-liner goes
 * into the prompt as something already said and not to be repeated, and the
 * model is left with the only part that needed a model.
 */
const METRIC_SYSTEM = [
  HOUSE_RULES,
  "",
  "You are explaining one figure on one company's page, to a reader who has",
  "already been shown the textbook definition. Do not restate the definition.",
  "",
  "In three or four sentences: say what this company's figure works out to",
  "and, where the inputs are given, from what; note what stands out when it",
  "is read against the other figures for the same period or against its own",
  "history; and name what would ordinarily produce a figure like this for a",
  "company in this line of business.",
  "",
  "Where a comparison would need something you were not given — a sector",
  "average, a competitor, a later period — say that it is not available here",
  "rather than reaching for a figure.",
].join("\n");

export function metricExplanationPrompt(
  input: MetricExplanationInput,
): PromptSpec {
  const lines: string[] = [
    `Company: ${input.companyName} (${input.ticker})`,
    `Line of business: ${input.industry ?? "not recorded"}`,
    `Reader level: ${input.level} — ${LEVEL_GUIDANCE[input.level]}`,
    "",
    `Figure: ${input.term} (${input.metricKey})`,
    `Value as displayed: ${input.formatted}`,
    `Period: ${input.periodType} ending ${isoDate(input.periodEnd)}`,
    input.origin === "derived"
      ? "Origin: computed by this app from the reported figures below and the live price."
      : "Origin: reported by the company in its SEC filings.",
    "",
    `Definition already shown to the reader (do not repeat it): ${input.oneLiner}`,
    "",
  ];

  if (input.history.length > 1) {
    lines.push("This figure over time, oldest first:");
    for (const h of input.history) {
      lines.push(`  ${isoDate(h.periodEnd)}: ${h.formatted}`);
    }
    lines.push("");
  }

  if (input.context.length > 0) {
    lines.push("Every other figure for the same period:");
    for (const c of input.context) {
      lines.push(`  ${c.metricKey}: ${c.formatted}`);
    }
    lines.push("");
  }

  return {
    kind: "metric_explanation",
    subject: `${input.ticker} · ${input.term}`,
    system: METRIC_SYSTEM,
    user: lines.join("\n").trimEnd(),
  };
}

/* ------------------------------------------------------------------ *
 * Morning digest opener
 * ------------------------------------------------------------------ */

export interface DigestSummaryInput {
  /** The morning it covers, as a date. */
  forDate: Date;
  /** The assembled digest, exactly as the reader will see it below. */
  markdown: string;
  itemCount: number;
}

/**
 * The two sentences at the top of the digest.
 *
 * The one job a model is unambiguously better at here: deciding which two of
 * fourteen items matter. Everything below it is already assembled, sorted and
 * linked by code — this does not restate the list, it says what to look at
 * first, which is a judgement about relative importance and not something a
 * sort order can express.
 */
const DIGEST_SYSTEM = [
  HOUSE_RULES,
  "",
  "You are writing the opening of a morning digest, above a list the reader",
  "is about to read in full. Two or three sentences.",
  "",
  "Say what deserves attention first and why, in the order you would look at",
  "it. Do not restate the list, do not enumerate everything, and do not",
  "introduce yourself or the digest. If nothing in it is consequential, say",
  "that plainly — a quiet morning is useful information and padding it out is",
  "how a digest becomes something nobody reads.",
].join("\n");

export function digestSummaryPrompt(input: DigestSummaryInput): PromptSpec {
  return {
    kind: "digest_summary",
    subject: `Digest for ${isoDate(input.forDate)}`,
    system: DIGEST_SYSTEM,
    user: [
      `Morning of ${isoDate(input.forDate)}. ${input.itemCount} items.`,
      "",
      input.markdown,
    ].join("\n"),
  };
}

/* ------------------------------------------------------------------ *
 * Article classification
 * ------------------------------------------------------------------ */

export interface ArticleClassificationInput {
  title: string;
  snippet: string | null;
  publisher: string | null;
  companies: string[];
}

/**
 * Every event type, described well enough to choose between them.
 *
 * Descriptions rather than bare labels, because "other" and "product" are
 * both defensible for a partnership announcement until you say which one the
 * app means.
 */
const EVENT_DESCRIPTIONS: Array<[EventType, string]> = [
  ["earnings", "results for a period: revenue, profit, a quarterly or annual report"],
  ["guidance", "a forecast, outlook, or a change to one"],
  ["ma", "an acquisition, merger, divestment, stake or joint venture"],
  ["leadership", "an executive or board appointment, departure or succession"],
  ["capital_return", "a dividend, a buyback, or a change to either"],
  ["legal", "litigation, a regulatory action, an investigation or a settlement"],
  ["product", "a launch, a partnership, a contract, an operational development"],
  ["analyst", "a rating change, a price target, or a broker note"],
  ["opinion", "commentary or stock-picking rather than a report of an event"],
  ["other", "a real event that fits none of the above"],
];

/**
 * The classifier of last resort.
 *
 * The keyword rules in src/news/classify.ts handle the great majority and are
 * kept as the first pass on purpose: they are free, instant, and you can read
 * why they decided what they decided. This runs only on what they returned
 * "other" for — the borderline residue — which is both the cheapest place to
 * spend a model and the place where a rule cannot be written, because if the
 * wording were predictable there would already be a rule for it.
 *
 * The answer is one word from a closed list rather than a JSON object. It
 * needs no schema support, so it works whatever model is configured, and an
 * answer outside the list is rejected by the caller rather than coerced.
 */
const CLASSIFY_SYSTEM = [
  "You classify news headlines about public companies by what kind of event",
  "they report.",
  "",
  "Answer with exactly one word from this list and nothing else — no",
  "explanation, no punctuation, no preamble:",
  "",
  ...EVENT_DESCRIPTIONS.map(([type, desc]) => `  ${type} — ${desc}`),
  "",
  "Judge what the article reports, not how it is written. A piece about",
  "earnings that exists to argue the stock is a buy is opinion. If nothing",
  "fits, answer other.",
].join("\n");

export function articleClassificationPrompt(
  input: ArticleClassificationInput,
): PromptSpec {
  const lines = [`Headline: ${input.title}`];
  if (input.publisher) lines.push(`Publisher: ${input.publisher}`);
  if (input.companies.length > 0) {
    lines.push(`About: ${input.companies.join(", ")}`);
  }
  if (input.snippet) lines.push(`Snippet: ${input.snippet}`);

  return {
    kind: "article_classification",
    subject: input.title,
    system: CLASSIFY_SYSTEM,
    user: lines.join("\n"),
  };
}

/** The closed list the classifier's answer is checked against. */
export const CLASSIFIABLE_EVENT_TYPES: EventType[] = EVENT_DESCRIPTIONS.map(
  ([type]) => type,
);

/**
 * Narrow a model's answer to the enum, or reject it.
 *
 * Tolerant of the punctuation and casing a model may add around a word it was
 * asked for bare, and intolerant of everything else. A sentence — even one
 * containing the right word — is rejected rather than mined for a match: if
 * the model explained its reasoning, it did not do what was asked, and
 * extracting a category from prose is guessing.
 */
export function parseEventType(
  raw: string,
  allowed: EventType[],
): EventType | null {
  const cleaned = raw.trim().toLowerCase().replace(/^[^a-z]+|[^a-z_]+$/g, "");
  return allowed.find((t) => t === cleaned) ?? null;
}
