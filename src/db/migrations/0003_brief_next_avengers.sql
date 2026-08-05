CREATE TYPE "public"."event_kind" AS ENUM('earnings', 'dividend', 'split', 'shareholder_meeting');--> statement-breakpoint
CREATE TYPE "public"."period_type" AS ENUM('annual', 'quarterly', 'ttm');--> statement-breakpoint
CREATE TABLE "company_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"kind" "event_kind" NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"payload" jsonb,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"cik" text NOT NULL,
	"accession_no" text NOT NULL,
	"form_type" text NOT NULL,
	"filed_at" timestamp with time zone NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fundamentals" (
	"security_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"period_type" "period_type" NOT NULL,
	"value" numeric(30, 6) NOT NULL,
	"unit" text DEFAULT 'USD' NOT NULL,
	"source" text NOT NULL,
	"filed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fundamentals_security_id_metric_key_period_end_period_type_pk" PRIMARY KEY("security_id","metric_key","period_end","period_type")
);
--> statement-breakpoint
ALTER TABLE "company_events" ADD CONSTRAINT "company_events_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filings" ADD CONSTRAINT "filings_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundamentals" ADD CONSTRAINT "fundamentals_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_events_unique" ON "company_events" USING btree ("security_id","kind","scheduled_at");--> statement-breakpoint
CREATE INDEX "company_events_scheduled_idx" ON "company_events" USING btree ("scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "filings_accession_key" ON "filings" USING btree ("accession_no");--> statement-breakpoint
CREATE INDEX "filings_security_filed_idx" ON "filings" USING btree ("security_id","filed_at");--> statement-breakpoint
CREATE INDEX "fundamentals_security_metric_idx" ON "fundamentals" USING btree ("security_id","metric_key");