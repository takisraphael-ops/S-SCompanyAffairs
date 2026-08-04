import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * Connection handling.
 *
 * Both the client and the drizzle instance hang off `globalThis` so that dev
 * HMR — which re-evaluates modules on every edit — reuses one pool instead of
 * opening a new one per reload until Postgres refuses connections.
 *
 * Initialisation is lazy (`getDb()`, not a module-scope `db`) so importing
 * this file during `next build` does not require DATABASE_URL to be present.
 */

type GlobalWithDb = typeof globalThis & {
  __ssSql?: postgres.Sql;
  __ssDb?: PostgresJsDatabase<typeof schema>;
};

const g = globalThis as GlobalWithDb;

export function getSql(): postgres.Sql {
  if (!g.__ssSql) {
    g.__ssSql = postgres(getEnv().DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return g.__ssSql;
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!g.__ssDb) {
    g.__ssDb = drizzle(getSql(), { schema });
  }
  return g.__ssDb;
}

/** Scripts must call this or the process hangs on an open pool. */
export async function closeDb(): Promise<void> {
  if (g.__ssSql) {
    await g.__ssSql.end({ timeout: 5 });
    g.__ssSql = undefined;
    g.__ssDb = undefined;
  }
}

export { schema };
