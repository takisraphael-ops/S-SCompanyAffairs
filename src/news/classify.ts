import type { EventType, SourceKind } from "@/db/schema";

/**
 * Separating what happened to a business from commentary about its stock.
 *
 * Rules, not a model. They are inspectable, free, and good enough at the one
 * job that matters: pushing "3 AI Stocks To Buy Before They Explode" below an
 * 8-K. A classifier trained for this would be better, but it would also be
 * something you cannot read and correct when it goes wrong.
 */

interface Rule {
  type: EventType;
  pattern: RegExp;
}

/**
 * Order matters — the first match wins, so the most specific and most
 * material patterns come first. Opinion is checked before the rest because a
 * listicle mentioning earnings is still a listicle.
 */
const RULES: Rule[] = [
  {
    // Listicles and stock-picking commentary. The dominant category by volume
    // and the one worth suppressing hardest.
    type: "opinion",
    pattern:
      /\b(\d+\s+(?:top|best|great|growth|dividend|ai|value)?\s*stocks?\b|stocks?\s+to\s+(?:buy|watch|sell|avoid)|should\s+you\s+(?:buy|sell)|is\s+\w+\s+stock\s+a\s+(?:buy|sell)|here'?s\s+why|reasons?\s+to\s+(?:buy|sell)|why\s+\w+\s+stock\s+(?:is|could|will|might)|better\s+buy|prediction|my\s+top\s+pick|millionaire|no[-\s]brainer|magnificent\s+seven)\b/i,
  },
  {
    type: "earnings",
    pattern:
      /\b(q[1-4]\s+(?:20\d\d\s+)?(?:results|earnings)|first|second|third|fourth)?\s*\b(quarter(?:ly)?\s+results|earnings\s+(?:report|results|call|release)|reports?\s+(?:record\s+)?(?:first|second|third|fourth|q[1-4]|full[-\s]year|fiscal)|posts?\s+(?:profit|loss|revenue)|beats?\s+(?:on\s+)?(?:estimates|expectations|earnings)|misses?\s+(?:on\s+)?(?:estimates|expectations)|announces?\s+(?:financial\s+)?results)\b/i,
  },
  {
    type: "guidance",
    pattern:
      /\b(guidance|outlook|forecasts?|raises?\s+(?:full[-\s]year|fy|its)|cuts?\s+(?:full[-\s]year|fy|its)|warns?\s+(?:on|of|about)|profit\s+warning|revises?\s+(?:its\s+)?(?:outlook|forecast))\b/i,
  },
  {
    type: "ma",
    pattern:
      /\b(acquires?|acquisition|to\s+acquire|merger|merges?\s+with|takeover|buyout|to\s+buy\s+\w+\s+for|divests?|spin[-\s]?off|stake\s+in|joint\s+venture)\b/i,
  },
  {
    type: "leadership",
    pattern:
      /\b(ceo|cfo|coo|cto|chief\s+\w+\s+officer|chairman|president|board\s+of\s+directors)\b.*\b(appoint|nam(?:e|ed|es)|steps?\s+down|resign|depart|retire|succeed|replace|hire|exit|ouster|fired)\b|\b(appoints?|names?)\b.*\b(ceo|cfo|coo|cto|chief|chairman|president)\b/i,
  },
  {
    type: "capital_return",
    pattern:
      /\b(dividend|buyback|share\s+repurchase|repurchase\s+program|stock\s+split|special\s+distribution)\b/i,
  },
  {
    type: "legal",
    pattern:
      /\b(lawsuit|sues?|sued|settlement|settles?|investigation|probe|subpoena|antitrust|regulator[sy]?|fine[sd]?\s+\$|penalty|recall|class\s+action|indict|doj|ftc|sec\s+charges)\b/i,
  },
  {
    type: "product",
    pattern:
      /\b(launch(?:es|ed|ing)?|unveil(?:s|ed|ing)?|introduc(?:es|ed|ing)|announces?\s+(?:new|the)|debuts?|releases?\s+(?:new|the)|partnership\s+with|supply\s+(?:agreement|deal)|signs?\s+(?:a\s+)?(?:multi[-\s]year\s+)?(?:agreement|deal|contract)|contract\s+(?:win|award)|awarded\s+(?:a\s+)?contract|fda\s+(?:approval|clearance))\b/i,
  },
  {
    type: "analyst",
    pattern:
      /\b(upgrade[sd]?|downgrade[sd]?|price\s+target|initiat(?:es|ed)\s+coverage|rating\s+(?:to|from)|analysts?\s+(?:say|expect)|overweight|underweight|outperform|neutral\s+rating)\b/i,
  },
];

export function classifyEvent(title: string, snippet?: string | null): EventType {
  const text = `${title} ${snippet ?? ""}`;
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.type;
  }
  return "other";
}

/**
 * How much each event type matters for understanding a business.
 *
 * Analyst notes and opinion pieces are ranked low deliberately: they are
 * commentary about the stock, not developments at the company, and they
 * dominate raw feeds by volume.
 */
const EVENT_WEIGHT: Record<EventType, number> = {
  earnings: 1.0,
  guidance: 0.95,
  ma: 0.95,
  leadership: 0.85,
  legal: 0.8,
  capital_return: 0.75,
  product: 0.65,
  other: 0.45,
  analyst: 0.3,
  opinion: 0.1,
};

/** Default trust by outlet type; individual sources may override. */
export const DEFAULT_SOURCE_WEIGHT: Record<SourceKind, number> = {
  regulator: 1.0,
  ir: 0.95,
  wire: 0.85,
  outlet: 0.7,
  aggregator: 0.45,
  mock: 0.6,
};

/**
 * Combined 0–1 score used for ranking and for collapsing low-signal items.
 *
 * Multiplicative on purpose: a listicle from a trusted outlet is still a
 * listicle, and a genuine earnings report from an aggregator is still worth
 * less than the company's own release of it.
 */
export function materialityScore(
  event: EventType,
  sourceWeight: number,
): number {
  const score = (EVENT_WEIGHT[event] ?? 0.45) * sourceWeight;
  return Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000;
}

/** Below this an item is collapsed behind a disclosure in the feed. */
export const LOW_SIGNAL_THRESHOLD = 0.35;

/** Human label for an event badge. */
export const EVENT_LABEL: Record<EventType, string> = {
  earnings: "Earnings",
  guidance: "Guidance",
  ma: "M&A",
  leadership: "Leadership",
  capital_return: "Dividend / buyback",
  legal: "Legal",
  product: "Product",
  analyst: "Analyst",
  opinion: "Opinion",
  other: "Other",
};

/**
 * Concept explaining each event type, where P1 authored one. Lets an event
 * badge be a <Term> rather than an unexplained label.
 */
export const EVENT_CONCEPT: Partial<Record<EventType, string>> = {
  earnings: "earnings-call",
  guidance: "guidance",
  capital_return: "dividend",
  analyst: "earnings-surprise",
};
