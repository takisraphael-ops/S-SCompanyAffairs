CREATE TYPE "public"."generation_kind" AS ENUM('story_summary', 'filing_summary', 'metric_explanation', 'article_classification');--> statement-breakpoint
CREATE TABLE "ai_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "generation_kind" NOT NULL,
	"subject_key" text NOT NULL,
	"input_hash" text NOT NULL,
	"body" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"security_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_generations_subject_key" ON "ai_generations" USING btree ("kind","subject_key");--> statement-breakpoint
CREATE INDEX "ai_generations_security_idx" ON "ai_generations" USING btree ("security_id");