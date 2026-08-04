CREATE TYPE "public"."alert_channel" AS ENUM('inbox', 'email');--> statement-breakpoint
CREATE TYPE "public"."alert_kind" AS ENUM('price_above', 'price_below', 'price_move', 'new_filing', 'material_news', 'keyword', 'earnings_soon');--> statement-breakpoint
ALTER TYPE "public"."generation_kind" ADD VALUE 'digest_summary';--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"security_id" uuid,
	"dedupe_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text,
	"payload" jsonb,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"delivery_error" text
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT 'local' NOT NULL,
	"security_id" uuid,
	"kind" "alert_kind" NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channel" "alert_channel" DEFAULT 'inbox' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_states" (
	"rule_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"armed" boolean DEFAULT true NOT NULL,
	"last_fired_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_states_rule_id_security_id_pk" PRIMARY KEY("rule_id","security_id")
);
--> statement-breakpoint
CREATE TABLE "digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"for_date" timestamp with time zone NOT NULL,
	"body" text NOT NULL,
	"summary" text,
	"summary_model" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"delivered_at" timestamp with time zone,
	"delivery_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_states" ADD CONSTRAINT "alert_states_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_states" ADD CONSTRAINT "alert_states_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_events_dedupe_key" ON "alert_events" USING btree ("rule_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "alert_events_fired_idx" ON "alert_events" USING btree ("fired_at");--> statement-breakpoint
CREATE INDEX "alert_events_unread_idx" ON "alert_events" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "alert_rules_enabled_idx" ON "alert_rules" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "digests_for_date_key" ON "digests" USING btree ("for_date");