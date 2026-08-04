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
     * SEC requires a declarative User-Agent identifying the operator, in the
     * form "Name email@example.com". Requests without one get 403s.
     * https://www.sec.gov/os/webmaster-faq#developers
     */
    SEC_USER_AGENT: z
      .string()
      .min(1)
      .default("S&S Company Affairs (set SEC_USER_AGENT to name + email)"),

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
