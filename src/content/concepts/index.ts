import type { ConceptSource } from "../types";
import { balanceSheet } from "./balance-sheet";
import { cashFlow } from "./cash-flow";
import { dividendsAndReturns } from "./dividends-and-returns";
import { filingsAndEvents } from "./filings-and-events";
import { incomeStatement } from "./income-statement";
import { marketStructure } from "./market-structure";
import { portfolio } from "./portfolio";
import { pricesAndTrading } from "./prices-and-trading";
import { valuation } from "./valuation";

/**
 * Every concept, in the order they are presented within their category.
 * Order within each file is deliberate — roughly simplest first.
 */
export const ALL_CONCEPTS: ConceptSource[] = [
  ...pricesAndTrading,
  ...valuation,
  ...incomeStatement,
  ...balanceSheet,
  ...cashFlow,
  ...dividendsAndReturns,
  ...filingsAndEvents,
  ...portfolio,
  ...marketStructure,
];
