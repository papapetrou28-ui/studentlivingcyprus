CREATE TABLE "ads" (
	"id" serial PRIMARY KEY,
	"business" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"tier" text DEFAULT 'deal' NOT NULL,
	"starts_at" timestamp DEFAULT now() NOT NULL,
	"ends_at" timestamp NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY,
	"listing_id" integer,
	"roommate_id" integer,
	"sender_id" text NOT NULL,
	"sender_name" text DEFAULT '' NOT NULL,
	"sender_email" text NOT NULL,
	"body" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roommates" (
	"id" serial PRIMARY KEY,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"budget" integer NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"about" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"user_id" text PRIMARY KEY,
	"customer_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "views" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "reject_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "roommate_id" integer;