CREATE TYPE "public"."concept_level" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."progress_status" AS ENUM('seen', 'understood');--> statement-breakpoint
CREATE TABLE "concept_edges" (
	"concept_id" uuid NOT NULL,
	"prerequisite_id" uuid NOT NULL,
	CONSTRAINT "concept_edges_concept_id_prerequisite_id_pk" PRIMARY KEY("concept_id","prerequisite_id"),
	CONSTRAINT "concept_edges_no_self" CHECK ("concept_edges"."concept_id" <> "concept_edges"."prerequisite_id")
);
--> statement-breakpoint
CREATE TABLE "concept_metrics" (
	"metric_key" text PRIMARY KEY NOT NULL,
	"concept_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"term" text NOT NULL,
	"aliases" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"one_liner" text NOT NULL,
	"body" text NOT NULL,
	"level" "concept_level" DEFAULT 'beginner' NOT NULL,
	"category" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_progress" (
	"user_id" text NOT NULL,
	"concept_id" uuid NOT NULL,
	"status" "progress_status" DEFAULT 'seen' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_progress_user_id_concept_id_pk" PRIMARY KEY("user_id","concept_id")
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"level" "concept_level" DEFAULT 'beginner' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "concept_edges" ADD CONSTRAINT "concept_edges_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_edges" ADD CONSTRAINT "concept_edges_prerequisite_id_concepts_id_fk" FOREIGN KEY ("prerequisite_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_metrics" ADD CONSTRAINT "concept_metrics_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_progress" ADD CONSTRAINT "user_progress_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concept_edges_prereq_idx" ON "concept_edges" USING btree ("prerequisite_id");--> statement-breakpoint
CREATE UNIQUE INDEX "concepts_slug_key" ON "concepts" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "concepts_category_idx" ON "concepts" USING btree ("category");