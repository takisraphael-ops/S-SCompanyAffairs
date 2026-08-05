CREATE TYPE "public"."ingest_status" AS ENUM('running', 'ok', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"status" "ingest_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"items_ok" integer DEFAULT 0 NOT NULL,
	"items_failed" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "price_bars" (
	"security_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"open" numeric(18, 6),
	"high" numeric(18, 6),
	"low" numeric(18, 6),
	"close" numeric(18, 6) NOT NULL,
	"volume" numeric(20, 0),
	"provider" text NOT NULL,
	CONSTRAINT "price_bars_security_id_ts_pk" PRIMARY KEY("security_id","ts")
);
--> statement-breakpoint
CREATE TABLE "quotes_latest" (
	"security_id" uuid PRIMARY KEY NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"previous_close" numeric(18, 6),
	"change" numeric(18, 6),
	"change_pct" numeric(12, 6),
	"day_high" numeric(18, 6),
	"day_low" numeric(18, 6),
	"as_of" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"exchange" text,
	"cik" text,
	"sector" text,
	"industry" text,
	"aliases" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "securities_ticker_upper" CHECK ("securities"."ticker" = upper("securities"."ticker"))
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"thesis" text,
	"target_price" numeric(18, 6)
);
--> statement-breakpoint
ALTER TABLE "price_bars" ADD CONSTRAINT "price_bars_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes_latest" ADD CONSTRAINT "quotes_latest_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_runs_job_started_idx" ON "ingest_runs" USING btree ("job","started_at");--> statement-breakpoint
CREATE INDEX "price_bars_ts_idx" ON "price_bars" USING btree ("ts");--> statement-breakpoint
CREATE UNIQUE INDEX "securities_ticker_key" ON "securities" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "securities_cik_idx" ON "securities" USING btree ("cik");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_items_security_key" ON "watchlist_items" USING btree ("security_id");