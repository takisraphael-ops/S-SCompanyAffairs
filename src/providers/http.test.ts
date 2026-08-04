import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { z } from "zod";
import { ProviderError } from "./errors";
import { fetchJson, redact } from "./http";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const schema = z.object({ value: z.number() });

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("redact", () => {
  it("strips API keys from query strings", () => {
    assert.equal(
      redact("https://finnhub.io/api/v1/quote?symbol=AAPL&token=secret123"),
      "https://finnhub.io/api/v1/quote?symbol=AAPL&token=REDACTED",
    );
  });

  it("strips alternative key parameter names", () => {
    assert.match(redact("https://x.test/a?api_key=abc"), /api_key=REDACTED/);
    assert.match(redact("https://x.test/a?apikey=abc"), /apikey=REDACTED/);
  });

  it("leaves URLs without credentials alone", () => {
    const url = "https://data.sec.gov/submissions/CIK0000320193.json";
    assert.equal(redact(url), url);
  });

  it("does not throw on a malformed URL", () => {
    assert.equal(redact("not a url"), "not a url");
  });
});

describe("fetchJson error mapping", () => {
  it("never leaks the API key into the error message", async () => {
    globalThis.fetch = (async () => jsonResponse({}, 500)) as typeof fetch;

    await assert.rejects(
      fetchJson("https://x.test/a?token=supersecret", {
        provider: "test",
        schema,
        retries: 0,
      }),
      (err: ProviderError) => {
        assert.ok(!err.message.includes("supersecret"), err.message);
        assert.match(err.message, /REDACTED/);
        return true;
      },
    );
  });

  it("maps 404 to not_found and does not retry it", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return jsonResponse({ error: "nope" }, 404);
    }) as typeof fetch;

    await assert.rejects(
      fetchJson("https://x.test/a", { provider: "test", schema }),
      (err: ProviderError) => {
        assert.equal(err.code, "not_found");
        assert.equal(err.retryable, false);
        return true;
      },
    );
    assert.equal(calls, 1, "client errors must not be retried");
  });

  it("maps 401/403 to unauthorized", async () => {
    globalThis.fetch = (async () => jsonResponse({}, 403)) as typeof fetch;
    await assert.rejects(
      fetchJson("https://x.test/a", { provider: "test", schema, retries: 0 }),
      (err: ProviderError) => err.code === "unauthorized",
    );
  });

  it("treats a schema mismatch as a hard failure", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return jsonResponse({ value: "not a number" });
    }) as typeof fetch;

    await assert.rejects(
      fetchJson("https://x.test/a", { provider: "test", schema }),
      (err: ProviderError) => {
        assert.equal(err.code, "invalid_response");
        assert.equal(err.retryable, false);
        return true;
      },
    );
    assert.equal(calls, 1, "a changed contract cannot be fixed by retrying");
  });
});

describe("fetchJson retry behaviour", () => {
  it("retries a 429 and returns the eventual success", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls < 3) return jsonResponse({}, 429, { "retry-after": "0" });
      return jsonResponse({ value: 42 });
    }) as typeof fetch;

    const result = await fetchJson("https://x.test/a", {
      provider: "test",
      schema,
    });
    assert.deepEqual(result, { value: 42 });
    assert.equal(calls, 3);
  });

  it("retries 5xx responses", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls < 2) return jsonResponse({}, 503);
      return jsonResponse({ value: 1 });
    }) as typeof fetch;

    assert.deepEqual(
      await fetchJson("https://x.test/a", { provider: "test", schema }),
      { value: 1 },
    );
    assert.equal(calls, 2);
  });

  it("gives up after the configured attempts", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return jsonResponse({}, 503);
    }) as typeof fetch;

    await assert.rejects(
      fetchJson("https://x.test/a", { provider: "test", schema, retries: 2 }),
      (err: ProviderError) => err.code === "upstream",
    );
    assert.equal(calls, 3, "one initial attempt plus two retries");
  });

  it("classifies a network failure as retryable", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    await assert.rejects(
      fetchJson("https://x.test/a", { provider: "test", schema, retries: 1 }),
      (err: ProviderError) => {
        assert.equal(err.code, "network");
        assert.equal(err.retryable, true);
        return true;
      },
    );
    assert.equal(calls, 2);
  });

  it("retries malformed JSON, which is usually a truncated body", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) {
        return new Response("{ truncated", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return jsonResponse({ value: 7 });
    }) as typeof fetch;

    assert.deepEqual(
      await fetchJson("https://x.test/a", { provider: "test", schema }),
      { value: 7 },
    );
    assert.equal(calls, 2);
  });
});

describe("fetchJson timeouts", () => {
  it("aborts a slow response and reports a timeout", async () => {
    globalThis.fetch = (async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      // Honour the abort signal the way a real fetch does. The long timer is
      // deliberate: AbortSignal.timeout's own timer is unref'd, so without a
      // ref'd one here the event loop empties and the runner cancels the test.
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(
          () => resolve(new Response("{}", { status: 200 })),
          5_000,
        );
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }) as typeof fetch;

    await assert.rejects(
      fetchJson("https://x.test/a", {
        provider: "test",
        schema,
        timeoutMs: 50,
        retries: 0,
      }),
      (err: ProviderError) => {
        assert.equal(err.code, "timeout");
        return true;
      },
    );
  });
});
