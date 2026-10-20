CREATE TABLE "listings" (
	"id" serial PRIMARY KEY,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"area" text NOT NULL,
	"rent" integer NOT NULL,
	"beds" integer DEFAULT 0 NOT NULL,
	"deposit" integer DEFAULT 0 NOT NULL,
	"bills" integer DEFAULT 0 NOT NULL,
	"email" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"owner_token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
