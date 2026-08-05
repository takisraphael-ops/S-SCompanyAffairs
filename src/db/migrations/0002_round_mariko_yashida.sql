CREATE TYPE "public"."event_type" AS ENUM('earnings', 'guidance', 'ma', 'leadership', 'capital_return', 'legal', 'product', 'analyst', 'opinion', 'other');--> statement-breakpoint
CREATE TYPE "public"."link_method" AS ENUM('provider_tag', 'feed_query', 'ticker', 'name', 'alias');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('ir', 'wire', 'regulator', 'outlet', 'aggregator', 'mock');--> statement-breakpoint
CREATE TABLE "article_links" (
	"article_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"relevance" numeric(4, 3) NOT NULL,
	"method" "link_method" NOT NULL,
	CONSTRAINT "article_links_article_id_security_id_pk" PRIMARY KEY("article_id","security_id")
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"story_id" uuid NOT NULL,
	"url_canonical" text NOT NULL,
	"url_original" text NOT NULL,
	"title" text NOT NULL,
	"title_normalized" text NOT NULL,
	"publisher" text,
	"published_at" timestamp with time zone NOT NULL,
	"snippet" text,
	"simhash" text NOT NULL,
	"event_type" "event_type" DEFAULT 'other' NOT NULL,
	"materiality" numeric(4, 3) DEFAULT '0.5' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"weight" numeric(4, 3) DEFAULT '0.5' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "news_sources_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"article_count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_links" ADD CONSTRAINT "article_links_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_links" ADD CONSTRAINT "article_links_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_source_id_news_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."news_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_links_security_idx" ON "article_links" USING btree ("security_id");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_url_canonical_key" ON "articles" USING btree ("url_canonical");--> statement-breakpoint
CREATE INDEX "articles_published_idx" ON "articles" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "articles_story_idx" ON "articles" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "articles_title_norm_idx" ON "articles" USING btree ("title_normalized");