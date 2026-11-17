CREATE TYPE "public"."department_request_status" AS ENUM('pending', 'approved', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TABLE "department_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"university" text NOT NULL,
	"name" text NOT NULL,
	"status" "department_request_status" DEFAULT 'pending' NOT NULL,
	"resolved_name" text,
	"note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "department_requests" ADD CONSTRAINT "department_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_requests_one_pending" ON "department_requests" USING btree ("user_id") WHERE "department_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "department_requests_campus_idx" ON "department_requests" USING btree ("university","status");