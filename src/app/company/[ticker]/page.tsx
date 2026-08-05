import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EventsStrip } from "@/components/events-strip";
import { FilingsList } from "@/components/filings-list";
import { KeyFigures } from "@/components/key-figures";
import { NewsFeed } from "@/components/news-feed";
import { Term } from "@/components/term";
import { formatPrice, formatSigned, formatSignedPct, direction, toNumber } from "@/lib/format";
import {
  getLatestFundamentals,
  listEvents,
  listFilings,
} from "@/services/fundamentals";
import { listCompanyNews } from "@/services/news";
import { getSecurityByTicker } from "@/services/securities";
import { getQuoteFor } from "@/services/watchlist";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const security = await getSecurityByTicker(ticker);
  if (!security) return { title: "Not found" };

  return {
    title: `${security.ticker} · S&S Company Affairs`,
    description: `News and price for ${security.name}.`,
  };
}

/**
 * Company page: price, key figures, what is happening, filings and calendar.
 *
 * Every figure explains itself through the same `concept_metrics` mapping the
 * watchlist uses, so nothing here needs to know about concepts.
 */
export default async function CompanyPage({ params }: Props) {
  const { ticker } = await params;
  const security = await getSecurityByTicker(ticker);
  if (!security) notFound();

  // The quote is needed before fundamentals, because market cap, P/E and the
  // other price-dependent figures are derived from it at read time rather
  // than stored (src/lib/derive.ts).
  const quote = await getQuoteFor(security.id);

  const [news, snapshot, filings, events] = await Promise.all([
    listCompanyNews(security.id),
    getLatestFundamentals(security.id, { price: toNumber(quote?.price) }),
    listFilings(security.id),
    listEvents(security.id),
  ]);

  const dir = direction(quote?.changePct);

  return (
    <div>
      <Link
        href="/"
        className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← Watchlist
      </Link>

      <header className="mt-4 mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {security.ticker}
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            {security.name === security.ticker ? (
              <span className="italic text-neutral-400">Name unresolved</span>
            ) : (
              security.name
            )}
            {security.exchange && ` · ${security.exchange}`}
            {security.industry && ` · ${security.industry}`}
          </p>
        </div>

        {quote && (
          <div className="text-right">
            <div className="tnum text-2xl font-semibold">
              {formatPrice(quote.price)}
            </div>
            <div
              className={`tnum text-sm ${
                dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-neutral-500"
              }`}
            >
              {formatSigned(quote.change)} ({formatSignedPct(quote.changePct)})
            </div>
          </div>
        )}
      </header>

      {events.length > 0 && (
        <section className="mb-10">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Calendar
          </h3>
          <EventsStrip events={events} />
        </section>
      )}

      <section className="mb-10">
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
          Key figures
        </h3>
        <p className="mb-3 text-xs text-neutral-400">
          Hover a label for what the figure is. Press{" "}
          <span className="font-medium">Why?</span> for what this company&apos;s
          figure works out to and what would explain it — written by a model
          from the numbers on this page, and cached once written.
        </p>
        <KeyFigures snapshot={snapshot} securityId={security.id} />
      </section>

      <section className="mb-10">
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
          What&apos;s happening
        </h3>
        <p className="mb-4 text-xs text-neutral-400">
          Duplicate coverage of the same event is collapsed into one entry.
          Opinion pieces and{" "}
          <Term slug="earnings-surprise">analyst notes</Term> are moved to the
          bottom.
        </p>
        <NewsFeed
          items={news}
          currentTicker={security.ticker}
          emptyMessage={`No news stored for ${security.ticker} yet. Run \`npm run ingest:news\`.`}
        />
      </section>

      <section>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
          Filings
        </h3>
        <p className="mb-3 text-xs text-neutral-400">
          Straight from SEC EDGAR. Each form code is translated — these are the
          primary documents everything else is written from.
        </p>
        <FilingsList filings={filings} />
      </section>
    </div>
  );
}
