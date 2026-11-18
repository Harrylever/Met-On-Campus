CREATE TABLE "campus_interest" (
	"slug" text PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campuses" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"open" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Every campus that exists today stays open: the launch campus, any university with students, and any campus that already has its own list entries.
INSERT INTO "campuses" ("slug", "name") VALUES ('futminna', 'FUTMinna') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "campuses" ("slug", "name") SELECT s, upper(s) FROM (SELECT "university" AS s FROM "users" UNION SELECT "university" FROM "departments" WHERE "university" IS NOT NULL UNION SELECT "university" FROM "campus_spots" WHERE "university" IS NOT NULL) x WHERE s <> '' ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Until now a list entry with no campus applied to every campus. Each campus now has its own list, so copy those shared entries into every campus (skipping names the campus already has). The shared rows stay behind as the template a new campus starts from; students no longer see them.
INSERT INTO "departments" ("name", "university", "active", "sort_order") SELECT d."name", c."slug", d."active", d."sort_order" FROM "departments" d CROSS JOIN "campuses" c WHERE d."university" IS NULL AND NOT EXISTS (SELECT 1 FROM "departments" x WHERE x."university" = c."slug" AND lower(x."name") = lower(d."name"));--> statement-breakpoint
INSERT INTO "campus_spots" ("name", "university", "active", "sort_order") SELECT d."name", c."slug", d."active", d."sort_order" FROM "campus_spots" d CROSS JOIN "campuses" c WHERE d."university" IS NULL AND NOT EXISTS (SELECT 1 FROM "campus_spots" x WHERE x."university" = c."slug" AND lower(x."name") = lower(d."name"));
