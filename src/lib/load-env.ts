import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load .env files for standalone scripts (migrations, ingest, drizzle-kit).
 *
 * Next loads these itself for app code; plain `tsx` does not. Precedence
 * matches Next's: .env.local wins over .env, and anything already exported in
 * the real environment wins over both (loadEnvFile does not overwrite).
 */
export function loadEnvFiles(cwd: string = process.cwd()): void {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(cwd, file);
    if (existsSync(path)) {
      try {
        process.loadEnvFile(path);
      } catch {
        // Malformed or unreadable file — fall through to real env vars.
      }
    }
  }
}
