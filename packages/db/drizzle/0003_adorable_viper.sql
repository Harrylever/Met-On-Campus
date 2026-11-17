CREATE TABLE "campus_spots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"university" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"university" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "campus_spots_name_campus" ON "campus_spots" USING btree (lower("name"),coalesce("university", ''));--> statement-breakpoint
CREATE UNIQUE INDEX "departments_name_campus" ON "departments" USING btree (lower("name"),coalesce("university", ''));--> statement-breakpoint
-- Seed: today's lists, so behaviour is unchanged on deploy. Idempotent (the unique indexes make re-runs a no-op).
INSERT INTO "departments" ("name", "sort_order") VALUES ('Cyber Security', 10), ('Computer Science', 20), ('Information Technology', 30), ('Electrical Engineering', 40) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "campus_spots" ("name", "sort_order") VALUES ('University Library', 10), ('Senate Building Lounge', 20), ('Faculty Quad', 30), ('Student Union Cafeteria', 40), ('ICT Centre', 50), ('School Field', 60) ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Anything students already chose that is not in the defaults is kept, so no one ends up with an unlisted value.
INSERT INTO "departments" ("name", "sort_order") SELECT DISTINCT "department", 100 FROM "users" WHERE "department" <> 'Unspecified' AND "department" <> '' ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "campus_spots" ("name", "sort_order") SELECT DISTINCT "usual_spot", 100 FROM "intent_profiles" WHERE "usual_spot" <> '' ON CONFLICT DO NOTHING;
