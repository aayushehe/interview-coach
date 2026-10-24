// Database schema, applied automatically when the server starts.
// Generated from lib/db/src/schema with drizzle-kit. To change the schema later: edit the schema file,
// add a NEW entry below (never edit an old one), and restart the server.
export const MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: "0000_init",
    sql: `CREATE TABLE "answers" (
	"id" text PRIMARY KEY NOT NULL,
	"interview_id" text NOT NULL,
	"question" text NOT NULL,
	"transcript" text NOT NULL,
	"duration_seconds" double precision NOT NULL,
	"pause_count" integer DEFAULT 0 NOT NULL,
	"filler_word_count" integer DEFAULT 0 NOT NULL,
	"analysis" jsonb,
	"delivery" jsonb,
	"session_id" text,
	"seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text,
	"title" text NOT NULL,
	"role" text NOT NULL,
	"company" text,
	"status" text DEFAULT 'active' NOT NULL,
	"answer_count" integer DEFAULT 0 NOT NULL,
	"score" integer,
	"resume_context" text DEFAULT '' NOT NULL,
	"topic" text DEFAULT 'General interview' NOT NULL,
	"level" text DEFAULT 'Intern / Fresher' NOT NULL,
	"job_description" text DEFAULT '' NOT NULL,
	"asked_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_question" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"interview_id" text NOT NULL,
	"id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"planned_questions" integer NOT NULL,
	"answered_count" integer NOT NULL,
	"ended_early" boolean DEFAULT false NOT NULL,
	"stats" jsonb NOT NULL,
	"review" jsonb,
	"review_note" text,
	CONSTRAINT "sessions_interview_id_id_pk" PRIMARY KEY("interview_id","id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answers_interview_created_idx" ON "answers" USING btree ("interview_id","created_at");--> statement-breakpoint
CREATE INDEX "answers_session_idx" ON "answers" USING btree ("interview_id","session_id");--> statement-breakpoint
CREATE INDEX "interviews_owner_updated_idx" ON "interviews" USING btree ("owner_id","updated_at");`,
  },
];
