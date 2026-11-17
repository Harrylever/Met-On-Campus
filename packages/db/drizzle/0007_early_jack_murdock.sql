ALTER TABLE "room_members" ADD COLUMN "decision_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
-- Existing members have already seen how their rooms turned out: do not show them as news.
UPDATE "room_members" SET "decision_seen_at" = now();