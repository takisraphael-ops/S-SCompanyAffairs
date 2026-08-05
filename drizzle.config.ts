import { defineConfig } from "drizzle-kit";
import { loadEnvFiles } from "./src/lib/load-env";

loadEnvFiles();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
