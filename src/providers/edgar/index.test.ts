import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { EdgarProvider, padCik, resetEdgarCache } from "./index";

/**
 * Fixtures mirror the real SEC payload shapes, in particular the fact that
 * `filings.recent` is column-wise parallel arrays rather than a list of
 * objects. Live calls to sec.gov are not made here.
 */

const TICKER_MAP = {
  "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
  "1": { cik_str: 789019, ticker: "MSFT", title: "MICROSOFT CORP" },
  "2": { cik_str: 1067983, ticker: "BRK-B", title: "BERKSHIRE HATHAWAY INC" },
};

const SUBMISSIONS = {
  cik: "320193",
  name: "Apple Inc.",
  tickers: ["AAPL"],
  exchanges: ["Nasdaq"],
  sicDescription: "Electronic Computers",
  filings: {
    recent: {
      accessionNumber: ["0000320193-24-000123", "0000320193-24-000081"],
      form: ["10-K", "8-K"],
      filingDate: ["2024-11-01", "2024-08-01"],
      primaryDocument: ["aapl-20240928.htm", "aapl-20240801.htm"],
      primaryDocDescription: ["Annual report", null],
    },
  },
};

const realFetch = globalThis.fetch;

function stubFetch(routes: Record<string, unknown>) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    for (const [fragment, body] of Object.entries(routes)) {
      if (url.includes(fragment)) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  resetEdgarCache();
});

describe("padCik", () => {
  it("zero-pads to 10 digits", () => {
    assert.equal(padCik(320193), "0000320193");
    assert.equal(padCik("320193"), "0000320193");
  });

  it("is idempotent on already-padded input", () => {
    assert.equal(padCik("0000320193"), "0000320193");
  });

  it("strips non-digits from CIK-prefixed strings", () => {
    assert.equal(padCik("CIK0000320193"), "0000320193");
  });
});

describe("EdgarProvider.resolveCik", () => {
  it("resolves a ticker to a padded CIK", async () => {
    stubFetch({ company_tickers: TICKER_MAP });
    const edgar = new EdgarProvider("test test@example.com");
    assert.equal(await edgar.resolveCik("AAPL"), "0000320193");
  });

  it("is case-insensitive", async () => {
    stubFetch({ company_tickers: TICKER_MAP });
    const edgar = new EdgarProvider("test test@example.com");
    assert.equal(await edgar.resolveCik("aapl"), "0000320193");
  });

  it("handles hyphenated share classes", async () => {
    stubFetch({ company_tickers: TICKER_MAP });
    const edgar = new EdgarProvider("test test@example.com");
    assert.equal(await edgar.resolveCik("BRK-B"), "0001067983");
  });

  it("returns null for an unknown ticker", async () => {
    stubFetch({ company_tickers: TICKER_MAP });
    const edgar = new EdgarProvider("test test@example.com");
    assert.equal(await edgar.resolveCik("NOTREAL"), null);
  });

  it("fetches the ticker map only once across calls", async () => {
    let hits = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("company_tickers")) hits++;
      return new Response(JSON.stringify(TICKER_MAP), { status: 200 });
    }) as typeof fetch;

    const edgar = new EdgarProvider("test test@example.com");
    await edgar.resolveCik("AAPL");
    await edgar.resolveCik("MSFT");
    assert.equal(hits, 1, "ticker map should be cached");
  });

  it("single-flights concurrent first calls", async () => {
    let hits = 0;
    globalThis.fetch = (async () => {
      hits++;
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify(TICKER_MAP), { status: 200 });
    }) as typeof fetch;

    const edgar = new EdgarProvider("test test@example.com");
    await Promise.all([
      edgar.resolveCik("AAPL"),
      edgar.resolveCik("MSFT"),
      edgar.resolveCik("BRK-B"),
    ]);
    assert.equal(hits, 1, "concurrent callers should share one fetch");
  });
});

describe("EdgarProvider.getProfile", () => {
  it("returns name, CIK, exchange and industry", async () => {
    stubFetch({ company_tickers: TICKER_MAP, submissions: SUBMISSIONS });
    const edgar = new EdgarProvider("test test@example.com");

    const profile = await edgar.getProfile("AAPL");
    assert.equal(profile?.name, "Apple Inc.");
    assert.equal(profile?.cik, "0000320193");
    assert.equal(profile?.exchange, "Nasdaq");
    assert.equal(profile?.industry, "Electronic Computers");
    assert.equal(profile?.ticker, "AAPL");
  });

  it("returns null when the ticker is not an SEC registrant", async () => {
    stubFetch({ company_tickers: TICKER_MAP });
    const edgar = new EdgarProvider("test test@example.com");
    assert.equal(await edgar.getProfile("NOTREAL"), null);
  });

  it("sends the declarative User-Agent SEC requires", async () => {
    let seen: string | null = null;
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      seen =
        new Headers(init?.headers).get("user-agent") ?? null;
      return new Response(JSON.stringify(TICKER_MAP), { status: 200 });
    }) as typeof fetch;

    const edgar = new EdgarProvider("Jane Dev jane@example.com");
    await edgar.resolveCik("AAPL");
    assert.equal(seen, "Jane Dev jane@example.com");
  });
});

describe("EdgarProvider.getRecentFilings", () => {
  it("zips the column-wise arrays into filing records", async () => {
    stubFetch({ submissions: SUBMISSIONS });
    const edgar = new EdgarProvider("test test@example.com");

    const filings = await edgar.getRecentFilings("0000320193");
    assert.equal(filings.length, 2);

    const [first, second] = filings;
    assert.equal(first?.formType, "10-K");
    assert.equal(first?.accessionNo, "0000320193-24-000123");
    assert.equal(first?.filedAt.toISOString(), "2024-11-01T00:00:00.000Z");
    assert.equal(first?.description, "Annual report");
    assert.equal(second?.formType, "8-K");
    assert.equal(second?.description, null);
  });

  it("builds an Archives URL with the padding stripped from the CIK", async () => {
    stubFetch({ submissions: SUBMISSIONS });
    const edgar = new EdgarProvider("test test@example.com");

    const [filing] = await edgar.getRecentFilings("0000320193");
    assert.equal(
      filing?.url,
      "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm",
    );
  });

  it("respects the limit", async () => {
    stubFetch({ submissions: SUBMISSIONS });
    const edgar = new EdgarProvider("test test@example.com");
    assert.equal((await edgar.getRecentFilings("0000320193", 1)).length, 1);
  });

  it("returns an empty list when a company has no filings", async () => {
    stubFetch({ submissions: { cik: "1", name: "Shell Co", filings: {} } });
    const edgar = new EdgarProvider("test test@example.com");
    assert.deepEqual(await edgar.getRecentFilings("0000000001"), []);
  });
});
