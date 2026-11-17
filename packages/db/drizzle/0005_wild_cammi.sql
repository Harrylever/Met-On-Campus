CREATE TYPE "public"."photo_status" AS ENUM('pending', 'approved', 'rejected', 'replaced', 'removed');--> statement-breakpoint
CREATE TABLE "profile_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"intent" "intent" NOT NULL,
	"storage_key" text NOT NULL,
	"status" "photo_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_photos" ADD CONSTRAINT "profile_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_photos_one_pending" ON "profile_photos" USING btree ("user_id","intent") WHERE "profile_photos"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "profile_photos_one_approved" ON "profile_photos" USING btree ("user_id","intent") WHERE "profile_photos"."status" = 'approved';--> statement-breakpoint
CREATE INDEX "profile_photos_queue_idx" ON "profile_photos" USING btree ("status","created_at");