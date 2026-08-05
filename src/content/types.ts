import type { ConceptLevel } from "@/db/schema";

/**
 * Authoring shape for a concept.
 *
 * Content lives in the repo as typed modules rather than loose markdown with
 * frontmatter: the level and category unions are checked at compile time, and
 * `requires`/`metrics` are validated at seed time with named errors. The body
 * is still plain markdown, so writing one reads like writing prose.
 */
export interface ConceptSource {
  /** URL segment. Stable — changing it breaks links people have saved. */
  slug: string;
  term: string;
  /** Other names for the same idea. Used by search. */
  aliases?: string[];
  /**
   * Tooltip text. Has to make sense alone, with no article and no context,
   * to someone who just hovered a word they did not recognise.
   */
  oneLiner: string;
  /** Markdown body. */
  body: string;
  level: ConceptLevel;
  category: Category;
  /** Slugs that must be understood first. Forms a DAG; cycles are rejected. */
  requires?: string[];
  /** Metric keys this concept explains. See src/lib/metrics.ts. */
  metrics?: string[];
}

export const CATEGORIES = [
  "Prices and trading",
  "Company size and valuation",
  "Income statement",
  "Balance sheet",
  "Cash flow",
  "Dividends and returns",
  "Filings and events",
  "Portfolio",
  "Market structure",
] as const;

export type Category = (typeof CATEGORIES)[number];
