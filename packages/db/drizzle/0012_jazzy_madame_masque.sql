CREATE TABLE "user_badges" (
	"user_id" uuid NOT NULL,
	"badge" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoked_note" text,
	CONSTRAINT "user_badges_user_id_badge_pk" PRIMARY KEY("user_id","badge")
);
--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;