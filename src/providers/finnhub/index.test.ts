import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ProviderError } from "../errors";
import { FinnhubProvider } from "./index";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(body: unknown, status = 200) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

describe("FinnhubProvider.getQuote", () => {
  it("maps the single-letter fields to the normalised shape", async () => {
    stub({
      c: 189.5,
      d: 2.25,
      dp: 1.2,
      h: 190.1,
      l: 186.4,
      o: 187.0,
      pc: 187.25,
      t: 1_730_000_000,
    });

    const quote = await new FinnhubProvider("k").getQuote("AAPL");
    assert.equal(quote.ticker, "AAPL");
    assert.equal(quote.price, 189.5);
    assert.equal(quote.change, 2.25);
    assert.equal(quote.changePct, 1.2);
    assert.equal(quote.dayHigh, 190.1);
    assert.equal(quote.dayLow, 186.4);
    assert.equal(quote.previousClose, 187.25);
    assert.equal(quote.asOf.toISOString(), "2024-10-27T03:33:20.000Z");
  });

  it("treats the all-zero body as not_found rather than a $0 price", async () => {
    // Finnhub answers 200 with zeros for unknown symbols instead of 404.
    stub({ c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 });

    await assert.rejects(
      new FinnhubProvider("k").getQuote("NOTREAL"),
      (err: ProviderError) => {
        assert.equal(err.code, "not_found");
        return true;
      },
    );
  });

  it("keeps a genuine zero-change quote", async () => {
    stub({ c: 12.5, d: 0, dp: 0, h: 12.5, l: 12.5, o: 12.5, pc: 12.5, t: 1_730_000_000 });
    const quote = await new FinnhubProvider("k").getQuote("FLAT");
    assert.equal(quote.price, 12.5);
    assert.equal(quote.change, 0);
  });

  it("tolerates null change fields", async () => {
    stub({ c: 50, d: null, dp: null, h: null, l: null, o: null, pc: 49, t: 1_730_000_000 });
    const quote = await new FinnhubProvider("k").getQuote("X");
    assert.equal(quote.change, null);
    assert.equal(quote.dayHigh, null);
    assert.equal(quote.previousClose, 49);
  });
});

describe("FinnhubProvider.getProfile", () => {
  it("returns null for the empty-object response", async () => {
    stub({});
    assert.equal(await new FinnhubProvider("k").getProfile("NOTREAL"), null);
  });

  it("maps profile fields", async () => {
    stub({ name: "Apple Inc", exchange: "NASDAQ NMS", finnhubIndustry: "Technology" });
    const profile = await new FinnhubProvider("k").getProfile("AAPL");
    assert.equal(profile?.name, "Apple Inc");
    assert.equal(profile?.industry, "Technology");
    assert.equal(profile?.cik, null, "CIK comes from EDGAR, not Finnhub");
  });
});

describe("FinnhubProvider.getDailyBars", () => {
  it("reports a paywalled candle endpoint as unsupported, not unauthorized", async () => {
    stub({ error: "You don't have access to this resource." }, 403);

    await assert.rejects(
      new FinnhubProvider("k").getDailyBars("AAPL", new Date(0), new Date()),
      (err: ProviderError) => {
        assert.equal(err.code, "unsupported");
        return true;
      },
    );
  });

  it("returns an empty series when the provider reports no data", async () => {
    stub({ s: "no_data" });
    const bars = await new FinnhubProvider("k").getDailyBars(
      "AAPL",
      new Date(0),
      new Date(),
    );
    assert.deepEqual(bars, []);
  });

  it("zips the parallel candle arrays", async () => {
    stub({
      s: "ok",
      t: [1_700_000_000, 1_700_086_400],
      o: [10, 11],
      h: [12, 13],
      l: [9, 10],
      c: [11, 12],
      v: [1000, 2000],
    });

    const bars = await new FinnhubProvider("k").getDailyBars(
      "AAPL",
      new Date(0),
      new Date(),
    );
    assert.equal(bars.length, 2);
    assert.equal(bars[0]?.close, 11);
    assert.equal(bars[0]?.volume, 1000);
    assert.equal(bars[1]?.high, 13);
  });
});
