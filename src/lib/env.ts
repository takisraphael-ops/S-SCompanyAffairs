import { z } from "zod";

/**
 * Server-side environment configuration.
 *
 * Validation is lazy and memoised rather than run at module scope: Next
 * evaluates modules during `next build` (page data collection) where the
 * runtime env is deliberately absent, and we do not want that to fail the
 * build. Call `getEnv()` from request/job code, never from module top level.
 */

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    // Which adapter backs each provider capability. See src/providers/registry.ts.
    QUOTE_PROVIDER: z.enum(["mock", "finnhub"]).default("mock"),
    FILINGS_PROVIDER: z.enum(["edgar"]).default("edgar"),

    /**
     * News adapters to run, comma-separated. Unlike quotes, several run
     * together — breadth of coverage matters more than picking one source,
     * and story clustering collapses the resulting overlap.
     */
    NEWS_PROVIDERS: z
      .string()
      .default("mock")
      .transform((raw) =>
        raw
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      )
      .pipe(z.array(z.enum(["mock", "finnhub", "rss"])).min(1)),

    /** How far back to look on each news ingest run. */
    NEWS_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(90).default(7),

    FINNHUB_API_KEY: z.string().optional(),

    /**
     * Which adapter writes the summaries and explanations. `mock` produces
     * clearly-labelled placeholder text so the feature is visible and the
     * plumbing is exercised without a key; `anthropic` calls the Claude API.
     */
    LLM_PROVIDER: z.enum(["mock", "anthropic"]).default("mock"),

    ANTHROPIC_API_KEY: z.string().optional(),

    /**
     * Two models, because the work splits cleanly in two.
     *
     * Most generation is mechanical — restate an SEC form, say what a cluster
     * of near-identical headlines has in common — and is high volume, so it
     * goes to the cheap model. Explaining why *this* company's figure looks
     * the way it does is contextual reasoning over numbers, is rare, and is
     * the one a reader will judge the app by, so it goes to the capable one.
     */
    ANTHROPIC_FAST_MODEL: z.string().min(1).default("claude-haiku-4-5"),
    ANTHROPIC_MODEL: z.string().min(1).default("claude-opus-5"),

    /**
     * Ceiling on generations per AI ingest run.
     *
     * The backlog on a first run is every story and every filing ever
     * ingested, and an unbounded job would spend the month's budget
     * discovering that. Work is ordered newest-first, so a capped run does
     * the part anyone is looking at and the next run continues.
     */
    AI_MAX_GENERATIONS_PER_RUN: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(25),

    /**
     * SEC requires a declarative User-Agent identifying the operator, in the
     * form "Name email@example.com". Requests without one get 403s.
     * https://www.sec.gov/os/webmaster-faq#developers
     */
    SEC_USER_AGENT: z
      .string()
      .min(1)
      .default("S&S Company Affairs (set SEC_USER_AGENT to name + email)"),

    /**
     * Where alerts and the digest are emailed from. `console` prints them,
     * which is the default: the alerts page is the primary channel and email
     * is the optional one, so nothing about this feature needs a key.
     */
    EMAIL_PROVIDER: z.enum(["console", "resend"]).default("console"),
    RESEND_API_KEY: z.string().optional(),
    /** Must be a verified sender on the Resend account. */
    EMAIL_FROM: z.string().optional(),
    EMAIL_TO: z.string().optional(),

    /**
     * How far back a newly created rule looks on its first evaluation.
     *
     * Without a bound, a "material news" rule created against a database
     * holding a month of articles would fire a hundred times at once and be
     * deleted immediately. A rule never fires for anything that happened
     * before it existed; this bounds the other end.
     */
    ALERT_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(30).default(3),

    /** Shared secret required by /api/cron/* routes. */
    CRON_SECRET: z.string().optional(),

    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  })
  .superRefine((val, ctx) => {
    if (val.QUOTE_PROVIDER === "finnhub" && !val.FINNHUB_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["FINNHUB_API_KEY"],
        message: "FINNHUB_API_KEY is required when QUOTE_PROVIDER=finnhub",
      });
    }
    if (val.NEWS_PROVIDERS.includes("finnhub") && !val.FINNHUB_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["FINNHUB_API_KEY"],
        message: "FINNHUB_API_KEY is required when NEWS_PROVIDERS includes finnhub",
      });
    }
    if (val.LLM_PROVIDER === "anthropic" && !val.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["ANTHROPIC_API_KEY"],
        message: "ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic",
      });
    }
    if (val.EMAIL_PROVIDER === "resend") {
      // All three, together: a key without addresses cannot send, and
      // discovering that at 7am when the digest silently fails is worse than
      // discovering it at startup.
      for (const [key, value] of [
        ["RESEND_API_KEY", val.RESEND_API_KEY],
        ["EMAIL_FROM", val.EMAIL_FROM],
        ["EMAIL_TO", val.EMAIL_TO],
      ] as const) {
        if (!value) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when EMAIL_PROVIDER=resend`,
          });
        }
      }
    }
    if (val.NODE_ENV === "production" && !val.CRON_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["CRON_SECRET"],
        message: "CRON_SECRET is required in production to protect cron routes",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }

  cached = parsed.data;
  return cached;
}

/** Test/script escape hatch: forget memoised config. */
export function resetEnvCache(): void {
  cached = null;
}
