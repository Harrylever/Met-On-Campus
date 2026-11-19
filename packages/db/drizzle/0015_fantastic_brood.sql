CREATE TABLE "push_broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text NOT NULL,
	"university" text,
	"department" text,
	"students" integer DEFAULT 0 NOT NULL,
	"devices" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "push_broadcasts_created_idx" ON "push_broadcasts" USING btree ("created_at");