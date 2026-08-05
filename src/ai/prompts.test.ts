import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLASSIFIABLE_EVENT_TYPES,
  articleClassificationPrompt,
  filingSummaryPrompt,
  metricExplanationPrompt,
  parseEventType,
  storySummaryPrompt,
  type MetricExplanationInput,
} from "./prompts";

const METRIC_BASE: MetricExplanationInput = {
  ticker: "AAPL",
  companyName: "Apple Inc.",
  industry: "Electronic Computers",
  metricKey: "pe_ratio",
  term: "P/E ratio",
  oneLiner: "What you pay for a dollar of the company's annual profit.",
  formatted: "47.20",
  origin: "derived",
  periodEnd: new Date(Date.UTC(2024, 8, 28)),
  periodType: "annual",
  context: [
    { metricKey: "net_income", formatted: "$93.74B" },
    { metricKey: "net_margin", formatted: "24.3%" },
  ],
  history: [
    { periodEnd: new Date(Date.UTC(2022, 8, 24)), formatted: "24.10" },
    { periodEnd: new Date(Date.UTC(2023, 8, 30)), formatted: "31.05" },
  ],
  level: "beginner",
};

/*
 * The grounding rule is the one thing in this file that is not stylistic.
 * Every prompt asserts the app's central claim — that a number and the words
 * beside it cannot disagree — so a rewrite that drops it should fail here
 * rather than be discovered in a summary that cites a figure nobody filed.
 */
test("every prompt forbids inventing figures", () => {
  const specs = [
    storySummaryPrompt({
      companies: [{ ticker: "AAPL", name: "Apple Inc." }],
      eventType: "earnings",
      articles: [
        {
          title: "Apple Reports Third Quarter Results",
          publisher: "Business Wire",
          sourceName: "Wire",
          publishedAt: new Date(Date.UTC(2024, 6, 1)),
          snippet: null,
        },
      ],
    }),
    filingSummaryPrompt({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      formType: "8-K",
      filedAt: new Date(Date.UTC(2024, 6, 1)),
      description: null,
    }),
    metricExplanationPrompt(METRIC_BASE),
  ];

  for (const spec of specs) {
    assert.match(
      spec.system,
      /Use only the figures and facts given/,
      `${spec.kind} lost its grounding constraint`,
    );
    assert.match(
      spec.system,
      /Never give investment advice/,
      `${spec.kind} lost its no-advice constraint`,
    );
  }
});

test("a metric prompt carries the figures the answer must agree with", () => {
  const spec = metricExplanationPrompt(METRIC_BASE);

  assert.match(spec.user, /47\.20/, "the value itself is missing");
  assert.match(spec.user, /\$93\.74B/, "same-period context is missing");
  assert.match(spec.user, /2023-09-30: 31\.05/, "history is missing");
  assert.match(spec.user, /Electronic Computers/, "the industry is missing");
});

test("a metric prompt hands over the authored definition as already said", () => {
  const spec = metricExplanationPrompt(METRIC_BASE);

  assert.match(spec.user, /do not repeat it/i);
  assert.ok(
    spec.user.includes(METRIC_BASE.oneLiner),
    "the static one-liner must be in the prompt, or the model will repeat it",
  );
});

test("reader level changes the prompt, and therefore the cache key", () => {
  const beginner = metricExplanationPrompt(METRIC_BASE);
  const advanced = metricExplanationPrompt({
    ...METRIC_BASE,
    level: "advanced",
  });

  assert.notEqual(
    beginner.user,
    advanced.user,
    "levels must differ, or switching level would serve the other one's text",
  );
  assert.match(advanced.user, /fluent/);
});

test("a metric prompt with no history omits the section rather than faking it", () => {
  const spec = metricExplanationPrompt({ ...METRIC_BASE, history: [] });
  assert.doesNotMatch(spec.user, /over time/);
});

test("a story prompt carries every headline in the cluster", () => {
  const spec = storySummaryPrompt({
    companies: [{ ticker: "MSFT", name: "Microsoft Corporation" }],
    eventType: "ma",
    articles: [
      {
        title: "Microsoft to acquire Contoso",
        publisher: "Reuters",
        sourceName: "Reuters",
        publishedAt: new Date(Date.UTC(2024, 3, 2)),
        snippet: "The deal values Contoso at an undisclosed sum.",
      },
      {
        title: "Microsoft announces Contoso acquisition",
        publisher: null,
        sourceName: "Mock Wire",
        publishedAt: new Date(Date.UTC(2024, 3, 2)),
        snippet: null,
      },
    ],
  });

  assert.match(spec.user, /Microsoft to acquire Contoso/);
  assert.match(spec.user, /Microsoft announces Contoso acquisition/);
  assert.match(spec.user, /Coverage: 2 articles/);
  // Falls back to the source when the feed named no publisher.
  assert.match(spec.user, /Mock Wire/);
});

/*
 * The filing summariser is given metadata, not the document. If the prompt
 * ever stops saying so, the model will happily describe contents it never
 * saw and the output will read exactly like a real summary.
 */
test("the filing prompt states that the document was not read", () => {
  const spec = filingSummaryPrompt({
    ticker: "AAPL",
    companyName: "Apple Inc.",
    formType: "10-K",
    filedAt: new Date(Date.UTC(2024, 10, 1)),
    description: "Annual report",
  });

  assert.match(spec.system, /have NOT read the document/);
  assert.match(spec.system, /Never state what this particular document says/);
  assert.match(spec.user, /10-K/);
  assert.match(spec.user, /2024-11-01/);
});

test("the classifier is constrained to the stored enum", () => {
  const spec = articleClassificationPrompt({
    title: "Apple names new CFO",
    snippet: null,
    publisher: "Reuters",
    companies: ["Apple Inc. (AAPL)"],
  });

  for (const type of CLASSIFIABLE_EVENT_TYPES) {
    assert.ok(
      spec.system.includes(`  ${type} —`),
      `${type} is missing from the closed list`,
    );
  }
  assert.match(spec.system, /exactly one word/);
});

test("a well-formed classification is accepted, punctuation and all", () => {
  for (const raw of ["leadership", "  Leadership  ", "leadership.", "**ma**"]) {
    assert.notEqual(
      parseEventType(raw, CLASSIFIABLE_EVENT_TYPES),
      null,
      `rejected ${JSON.stringify(raw)}`,
    );
  }
  assert.equal(parseEventType("Leadership.", CLASSIFIABLE_EVENT_TYPES), "leadership");
});

/*
 * The guard that keeps a chatty model from silently reordering the feed. A
 * sentence is rejected outright rather than searched for a category: if the
 * model explained itself, it did not answer the question, and picking a word
 * out of its reasoning is a guess dressed up as a classification.
 */
test("anything but a bare answer is rejected", () => {
  const junk = [
    "This looks like a leadership change to me.",
    "earnings or guidance",
    "I can't help with that.",
    "",
    "unknown",
  ];
  for (const raw of junk) {
    assert.equal(
      parseEventType(raw, CLASSIFIABLE_EVENT_TYPES),
      null,
      `accepted ${JSON.stringify(raw)}`,
    );
  }
});

test("prompts are deterministic, or the cache would never hit", () => {
  const a = metricExplanationPrompt(METRIC_BASE);
  const b = metricExplanationPrompt(METRIC_BASE);
  assert.equal(a.system, b.system);
  assert.equal(a.user, b.user);
});
