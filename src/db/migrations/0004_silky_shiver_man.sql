CREATE TYPE "public"."corporate_action_kind" AS ENUM('split', 'reverse_split');--> statement-breakpoint
CREATE TYPE "public"."cost_basis_method" AS ENUM('fifo', 'average');--> statement-breakpoint
CREATE TYPE "public"."transaction_kind" AS ENUM('buy', 'sell', 'dividend', 'transfer_in', 'transfer_out');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"cost_basis_method" "cost_basis_method" DEFAULT 'fifo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corporate_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"kind" "corporate_action_kind" NOT NULL,
	"ex_date" timestamp with time zone NOT NULL,
	"ratio" numeric(18, 8) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporate_actions_ratio_positive" CHECK ("corporate_actions"."ratio" > 0)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"kind" "transaction_kind" NOT NULL,
	"trade_date" timestamp with time zone NOT NULL,
	"quantity" numeric(24, 8) NOT NULL,
	"price" numeric(18, 8) NOT NULL,
	"fees" numeric(18, 8) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_quantity_positive" CHECK ("transactions"."quantity" > 0),
	CONSTRAINT "transactions_price_nonneg" CHECK ("transactions"."price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_actions_unique" ON "corporate_actions" USING btree ("security_id","kind","ex_date");--> statement-breakpoint
CREATE INDEX "corporate_actions_security_idx" ON "corporate_actions" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "transactions_account_date_idx" ON "transactions" USING btree ("account_id","trade_date","created_at");--> statement-breakpoint
CREATE INDEX "transactions_security_idx" ON "transactions" USING btree ("security_id");