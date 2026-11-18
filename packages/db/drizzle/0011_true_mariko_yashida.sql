CREATE TABLE "daily_checkins" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "daily_checkins_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "point_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"points" integer NOT NULL,
	"key" text NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_note" text
);
--> statement-breakpoint
CREATE TABLE "user_progress" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"points_total" integer DEFAULT 0 NOT NULL,
	"streak_current" integer DEFAULT 0 NOT NULL,
	"streak_best" integer DEFAULT 0 NOT NULL,
	"last_active_day" date,
	"last_rest_on" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invite_code" text DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 10) NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by" uuid;--> statement-breakpoint
ALTER TABLE "daily_checkins" ADD CONSTRAINT "daily_checkins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_events" ADD CONSTRAINT "point_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_progress" ADD CONSTRAINT "user_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "point_events_once" ON "point_events" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "point_events_user_idx" ON "point_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "point_events_day_idx" ON "point_events" USING btree ("user_id","day");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_users_id_fk" FOREIGN KEY ("referred_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_invite_code_unique" UNIQUE("invite_code");