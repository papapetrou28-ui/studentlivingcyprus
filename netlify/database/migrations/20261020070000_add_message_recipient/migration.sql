ALTER TABLE "messages" ADD COLUMN "recipient_id" text;--> statement-breakpoint
CREATE INDEX "messages_recipient_idx" ON "messages" ("recipient_id");--> statement-breakpoint
CREATE INDEX "messages_sender_idx" ON "messages" ("sender_id");--> statement-breakpoint
CREATE INDEX "listings_status_idx" ON "listings" ("status");--> statement-breakpoint
CREATE INDEX "listings_owner_idx" ON "listings" ("owner_id");--> statement-breakpoint
CREATE INDEX "roommates_owner_idx" ON "roommates" ("owner_id");
