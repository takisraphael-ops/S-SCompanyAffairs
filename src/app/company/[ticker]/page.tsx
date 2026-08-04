import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NewsFeed } from "@/components/news-feed";
import { Term } from "@/components/term";
import { formatPrice, formatSigned, formatSignedPct, direction } from "@/lib/format";
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
 * Company page.
 *
 * P2 fills this with news; P3 adds fundamentals, filings and the earnings
 * calendar alongside. The header deliberately reuses the same quote fields as
 * the watchlist so both explain themselves through the same concepts.
 */
export default async function CompanyPage({ params }: Props) {
  const { ticker } = await params;
  const security = await getSecurityByTicker(ticker);
  if (!security) notFound();

  const [news, quote] = await Promise.all([
    listCompanyNews(security.id),
    getQuoteFor(security.id),
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

      <section>
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
    </div>
  );
}
