// All database reads and writes for users, interviews, answers and sessions.
// The route code keeps working with plain StoredInterview objects; this file turns them into rows and back.
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { answersTable, db, interviewsTable, sessionsTable, usersTable } from "@workspace/db";
import type { Analysis, Delivery, SessionReview, StoredAnswer, StoredInterview, StoredSession } from "../routes/interviews";
import type { SessionStats } from "./session-stats";

/* ───────── users ───────── */
export type UserRow = typeof usersTable.$inferSelect;

export async function dbFindUserById(id: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  return row;
}
export async function dbFindUserByEmail(email: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  return row;
}
export async function dbCountUsers(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(usersTable);
  return row?.n ?? 0;
}
export async function dbInsertUser(user: { id: string; name: string; email: string; passwordHash: string }): Promise<void> {
  await db.insert(usersTable).values(user);
}

/* ───────── row <-> object ───────── */
type InterviewRow = typeof interviewsTable.$inferSelect;
type AnswerRow = typeof answersTable.$inferSelect;
type SessionRow = typeof sessionsTable.$inferSelect;

const toAnswer = (r: AnswerRow): StoredAnswer => ({
  id: r.id,
  question: r.question,
  transcript: r.transcript,
  durationSeconds: r.durationSeconds,
  pauseCount: r.pauseCount,
  fillerWordCount: r.fillerWordCount,
  analysis: (r.analysis as Analysis | null) ?? null,
  createdAt: r.createdAt.toISOString(),
  sessionId: r.sessionId,
  delivery: (r.delivery as Delivery | null) ?? null,
});

const toSession = (r: SessionRow): StoredSession => ({
  id: r.id,
  startedAt: r.startedAt.toISOString(),
  endedAt: r.endedAt.toISOString(),
  plannedQuestions: r.plannedQuestions,
  answeredCount: r.answeredCount,
  endedEarly: r.endedEarly,
  stats: r.stats as unknown as SessionStats,
  review: (r.review as SessionReview | null) ?? null,
  ...(r.reviewNote ? { reviewNote: r.reviewNote } : {}),
});

const toInterview = (r: InterviewRow, answers: StoredAnswer[] = [], sessions: StoredSession[] = []): StoredInterview => ({
  ownerId: r.ownerId ?? undefined,
  id: r.id,
  title: r.title,
  role: r.role,
  company: r.company,
  status: r.status === "completed" ? "completed" : "active",
  answerCount: r.answerCount,
  score: r.score,
  updatedAt: r.updatedAt.toISOString(),
  resumeContext: r.resumeContext,
  topic: r.topic,
  level: r.level,
  jobDescription: r.jobDescription,
  answers,
  sessions,
  askedQuestions: r.askedQuestions ?? [],
  currentQuestion: r.currentQuestion ?? null,
});

const date = (iso: string | undefined) => {
  const d = iso ? new Date(iso) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

export const interviewRow = (i: StoredInterview, ownerId: string | null) => ({
  id: i.id,
  ownerId,
  title: i.title,
  role: i.role,
  company: i.company,
  status: i.status,
  answerCount: i.answerCount,
  score: i.score,
  resumeContext: i.resumeContext,
  topic: i.topic,
  level: i.level,
  jobDescription: i.jobDescription,
  askedQuestions: i.askedQuestions,
  currentQuestion: i.currentQuestion,
  updatedAt: date(i.updatedAt),
});

export const answerRow = (interviewId: string, a: StoredAnswer, seq: number) => ({
  id: a.id,
  interviewId,
  question: a.question,
  transcript: a.transcript,
  durationSeconds: a.durationSeconds,
  pauseCount: a.pauseCount,
  fillerWordCount: a.fillerWordCount,
  analysis: a.analysis as unknown as Record<string, unknown> | null,
  delivery: a.delivery as unknown as Record<string, unknown> | null,
  sessionId: a.sessionId,
  seq,
  createdAt: date(a.createdAt),
});

export const sessionRow = (interviewId: string, s: StoredSession) => ({
  interviewId,
  id: s.id,
  startedAt: date(s.startedAt),
  endedAt: date(s.endedAt),
  plannedQuestions: s.plannedQuestions,
  answeredCount: s.answeredCount,
  endedEarly: s.endedEarly,
  stats: s.stats as unknown as Record<string, unknown>,
  review: s.review as unknown as Record<string, unknown> | null,
  reviewNote: s.reviewNote ?? null,
});

/* ───────── interviews ───────── */

/** Rooms of one account, newest first. Answers and sessions are not loaded (the list only needs the summary). */
export async function listInterviewsFor(ownerId: string): Promise<StoredInterview[]> {
  const rows = await db.select().from(interviewsTable).where(eq(interviewsTable.ownerId, ownerId)).orderBy(desc(interviewsTable.updatedAt));
  return rows.map((r) => toInterview(r));
}

/** One room with all its answers and sessions, but only if it belongs to this account. */
export async function loadInterview(ownerId: string, id: string): Promise<StoredInterview | undefined> {
  const [row] = await db.select().from(interviewsTable).where(and(eq(interviewsTable.id, id), eq(interviewsTable.ownerId, ownerId)));
  if (!row) return undefined;
  const [answers, sessions] = await Promise.all([
    db.select().from(answersTable).where(eq(answersTable.interviewId, id)).orderBy(asc(answersTable.seq), asc(answersTable.createdAt)),
    db.select().from(sessionsTable).where(eq(sessionsTable.interviewId, id)).orderBy(asc(sessionsTable.startedAt)),
  ]);
  return toInterview(row, answers.map(toAnswer), sessions.map(toSession));
}

/** Every room of one account with answers and sessions (used for the progress numbers). */
export async function loadAllInterviewsFor(ownerId: string): Promise<StoredInterview[]> {
  const rows = await db.select().from(interviewsTable).where(eq(interviewsTable.ownerId, ownerId)).orderBy(desc(interviewsTable.updatedAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [answers, sessions] = await Promise.all([
    db.select().from(answersTable).where(inArray(answersTable.interviewId, ids)).orderBy(asc(answersTable.seq), asc(answersTable.createdAt)),
    db.select().from(sessionsTable).where(inArray(sessionsTable.interviewId, ids)).orderBy(asc(sessionsTable.startedAt)),
  ]);
  const answersBy = new Map<string, StoredAnswer[]>();
  for (const a of answers) answersBy.set(a.interviewId, [...(answersBy.get(a.interviewId) ?? []), toAnswer(a)]);
  const sessionsBy = new Map<string, StoredSession[]>();
  for (const s of sessions) sessionsBy.set(s.interviewId, [...(sessionsBy.get(s.interviewId) ?? []), toSession(s)]);
  return rows.map((r) => toInterview(r, answersBy.get(r.id) ?? [], sessionsBy.get(r.id) ?? []));
}

export async function insertInterview(interview: StoredInterview, ownerId: string): Promise<void> {
  await db.insert(interviewsTable).values(interviewRow(interview, ownerId));
}

/**
 * Saves changes to a room: the room itself, any new answers and the sessions.
 * answer_count and score are recalculated by the database from the answers, so two requests finishing
 * at the same moment cannot overwrite each other's count.
 */
export async function saveInterview(interview: StoredInterview): Promise<void> {
  await db.transaction(async (tx) => {
    const row = interviewRow(interview, null);
    await tx
      .insert(interviewsTable)
      .values({ ...row, ownerId: interview.ownerId ?? null })
      .onConflictDoUpdate({
        target: interviewsTable.id,
        set: {
          title: row.title,
          role: row.role,
          company: row.company,
          status: row.status,
          resumeContext: row.resumeContext,
          topic: row.topic,
          level: row.level,
          jobDescription: row.jobDescription,
          askedQuestions: row.askedQuestions,
          currentQuestion: row.currentQuestion,
          updatedAt: row.updatedAt,
        },
      });
    if (interview.answers.length) {
      await tx.insert(answersTable).values(interview.answers.map((a, index) => answerRow(interview.id, a, index))).onConflictDoNothing();
    }
    for (const session of interview.sessions) {
      const values = sessionRow(interview.id, session);
      await tx
        .insert(sessionsTable)
        .values(values)
        .onConflictDoUpdate({
          target: [sessionsTable.interviewId, sessionsTable.id],
          set: {
            endedAt: values.endedAt,
            plannedQuestions: values.plannedQuestions,
            answeredCount: values.answeredCount,
            endedEarly: values.endedEarly,
            stats: values.stats,
            review: values.review,
            reviewNote: values.reviewNote,
          },
        });
    }
    await tx
      .update(interviewsTable)
      .set({
        answerCount: sql`(SELECT count(*)::int FROM answers WHERE interview_id = ${interview.id})`,
        score: sql`(SELECT round(avg(coalesce((analysis->'scores'->>'overall')::numeric, 0)))::int FROM answers WHERE interview_id = ${interview.id})`,
      })
      .where(eq(interviewsTable.id, interview.id));
  });
}

/** Deletes a room (its answers and sessions go with it). False when it does not exist or belongs to someone else. */
export async function deleteInterviewFor(ownerId: string, id: string): Promise<boolean> {
  const deleted = await db.delete(interviewsTable).where(and(eq(interviewsTable.id, id), eq(interviewsTable.ownerId, ownerId))).returning({ id: interviewsTable.id });
  return deleted.length > 0;
}

/** Rooms saved before accounts existed have no owner; the first account to sign up takes them. */
export async function adoptOrphanInterviews(ownerId: string): Promise<number> {
  const adopted = await db.update(interviewsTable).set({ ownerId }).where(isNull(interviewsTable.ownerId)).returning({ id: interviewsTable.id });
  return adopted.length;
}

export async function countInterviews(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(interviewsTable);
  return row?.n ?? 0;
}
