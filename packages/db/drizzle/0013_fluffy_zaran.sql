ALTER TABLE "user_progress" ADD COLUMN "leaderboard_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_progress" ADD COLUMN "leaderboard_at" timestamp with time zone;