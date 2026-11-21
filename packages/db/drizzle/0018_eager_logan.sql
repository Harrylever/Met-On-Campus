CREATE TYPE "public"."room_mode" AS ENUM('physical', 'online');--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "mode" "room_mode" DEFAULT 'physical' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "premium_until" timestamp with time zone;