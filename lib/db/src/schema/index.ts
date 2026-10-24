import { sql } from "drizzle-orm";
import { boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// Tables for Interview Coach. Ids are text (UUID strings made by the server).
// Nested things that are always read together (AI analysis, delivery numbers, session stats) are stored as jsonb.

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(), // always stored lower-case
  passwordHash: text("password_hash").notNull(), // scrypt hash, never the password
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const interviewsTable = pgTable(
  "interviews",
  {
    id: text("id").primaryKey(),
    // null only for rooms saved before accounts existed; the first account to sign up adopts them
    ownerId: text("owner_id").references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    role: text("role").notNull(),
    company: text("company"),
    status: text("status").notNull().default("active"),
    answerCount: integer("answer_count").notNull().default(0),
    score: integer("score"),
    resumeContext: text("resume_context").notNull().default(""),
    topic: text("topic").notNull().default("General interview"),
    level: text("level").notNull().default("Intern / Fresher"),
    jobDescription: text("job_description").notNull().default(""),
    askedQuestions: jsonb("asked_questions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    currentQuestion: jsonb("current_question").$type<{ text: string; source: "ai" | "bank" } | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("interviews_owner_updated_idx").on(table.ownerId, table.updatedAt)],
);

export const answersTable = pgTable(
  "answers",
  {
    id: text("id").primaryKey(),
    interviewId: text("interview_id").notNull().references(() => interviewsTable.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    transcript: text("transcript").notNull(),
    durationSeconds: doublePrecision("duration_seconds").notNull(),
    pauseCount: integer("pause_count").notNull().default(0),
    fillerWordCount: integer("filler_word_count").notNull().default(0),
    analysis: jsonb("analysis").$type<Record<string, unknown> | null>(),
    delivery: jsonb("delivery").$type<Record<string, unknown> | null>(),
    sessionId: text("session_id"),
    seq: integer("seq").notNull().default(0), // position inside the interview, keeps answers in the order they were given
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("answers_interview_created_idx").on(table.interviewId, table.createdAt),
    index("answers_session_idx").on(table.interviewId, table.sessionId),
  ],
);

export const sessionsTable = pgTable(
  "sessions",
  {
    interviewId: text("interview_id").notNull().references(() => interviewsTable.id, { onDelete: "cascade" }),
    id: text("id").notNull(), // chosen by the browser, so only unique inside one interview
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    plannedQuestions: integer("planned_questions").notNull(),
    answeredCount: integer("answered_count").notNull(),
    endedEarly: boolean("ended_early").notNull().default(false),
    stats: jsonb("stats").$type<Record<string, unknown>>().notNull(),
    review: jsonb("review").$type<Record<string, unknown> | null>(),
    reviewNote: text("review_note"),
  },
  (table) => [primaryKey({ columns: [table.interviewId, table.id] })],
);
