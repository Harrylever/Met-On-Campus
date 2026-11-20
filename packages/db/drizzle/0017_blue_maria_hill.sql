ALTER TABLE "intent_profiles" ADD COLUMN "show_gender" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "gender_values" CHECK ("users"."gender" in ('male', 'female'));