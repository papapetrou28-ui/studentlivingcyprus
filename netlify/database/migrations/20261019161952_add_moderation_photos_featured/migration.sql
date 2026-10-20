CREATE TABLE "payments" (
	"id" serial PRIMARY KEY,
	"session_id" text NOT NULL UNIQUE,
	"listing_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'eur' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY,
	"listing_id" integer,
	"kind" text DEFAULT 'report' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "photos" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "featured_until" timestamp;--> statement-breakpoint
-- Listings posted before moderation existed were already public, so keep them live
UPDATE "listings" SET "status" = 'approved';
