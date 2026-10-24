// One-time import of the old JSON files (users.json + interviews.json) into PostgreSQL.
// It only runs when the database is still empty, and renames the files afterwards so nothing is imported twice
// (the renamed copies stay as a backup).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, answersTable, interviewsTable, sessionsTable, usersTable } from "@workspace/db";
import { logger } from "./logger";
import { answerRow, countInterviews, dbCountUsers, interviewRow, sessionRow } from "./store";
import type { StoredAnswer, StoredInterview, StoredSession } from "../routes/interviews";

const DATA_DIR = process.env.INTERVIEWS_FILE
  ? path.dirname(path.resolve(process.env.INTERVIEWS_FILE))
  : path.resolve(process.cwd(), "data");
const INTERVIEWS_FILE = process.env.INTERVIEWS_FILE ? path.resolve(process.env.INTERVIEWS_FILE) : path.join(DATA_DIR, "interviews.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");

const readList = (file: string): unknown[] => {
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${path.basename(file)} is not a list`);
  return parsed;
};

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

function normalizeInterview(item: Partial<StoredInterview>, userIds: Set<string>): { interview: StoredInterview; ownerId: string | null } | null {
  if (!item || typeof item.id !== "string") return null;
  const savedAt = item.updatedAt ?? new Date().toISOString();
  const answers: StoredAnswer[] = (Array.isArray(item.answers) ? item.answers : []).map((a) => ({
    ...a,
    id: str(a.id) || crypto.randomUUID(),
    question: str(a.question),
    transcript: str(a.transcript),
    durationSeconds: Number.isFinite(a.durationSeconds) ? a.durationSeconds : 0,
    pauseCount: Number.isFinite(a.pauseCount) ? a.pauseCount : 0,
    fillerWordCount: Number.isFinite(a.fillerWordCount) ? a.fillerWordCount : 0,
    analysis: a.analysis ?? null,
    createdAt: a.createdAt ?? savedAt,
    sessionId: a.sessionId ?? null,
    delivery: a.delivery ?? null,
  }));
  const sessions = (Array.isArray(item.sessions) ? item.sessions : []).filter((s): s is StoredSession => !!s && typeof s.id === "string" && !!s.stats);
  const ownerId = typeof item.ownerId === "string" && userIds.has(item.ownerId) ? item.ownerId : null;
  return {
    ownerId,
    interview: {
      id: item.id,
      ownerId: ownerId ?? undefined,
      title: str(item.title, "Untitled interview"),
      role: str(item.role),
      company: item.company ?? null,
      status: item.status === "completed" ? "completed" : "active",
      answerCount: answers.length,
      score: typeof item.score === "number" ? item.score : null,
      updatedAt: savedAt,
      resumeContext: str(item.resumeContext),
      topic: str(item.topic, "General interview"),
      level: str(item.level, "Intern / Fresher"),
      jobDescription: str(item.jobDescription),
      answers,
      sessions,
      askedQuestions: Array.isArray(item.askedQuestions) ? item.askedQuestions.filter((q): q is string => typeof q === "string") : [],
      currentQuestion: item.currentQuestion ?? null,
    },
  };
}

export async function importLegacyJson(): Promise<void> {
  const haveFiles = fs.existsSync(USERS_FILE) || fs.existsSync(INTERVIEWS_FILE);
  if (!haveFiles) return;
  if ((await dbCountUsers()) > 0 || (await countInterviews()) > 0) {
    logger.info("Old JSON files found, but the database already has data, so nothing was imported");
    return;
  }

  const rawUsers = readList(USERS_FILE) as Array<{ id?: string; name?: string; email?: string; passwordHash?: string; createdAt?: string }>;
  const rawInterviews = readList(INTERVIEWS_FILE) as Partial<StoredInterview>[];

  const users = rawUsers.filter((u) => typeof u.id === "string" && typeof u.email === "string" && typeof u.passwordHash === "string");
  const userIds = new Set(users.map((u) => u.id as string));
  const interviews = rawInterviews.map((item) => normalizeInterview(item, userIds)).filter((x): x is NonNullable<typeof x> => x !== null);

  await db.transaction(async (tx) => {
    for (const u of users) {
      await tx.insert(usersTable).values({
        id: u.id as string,
        name: str(u.name),
        email: (u.email as string).toLowerCase(),
        passwordHash: u.passwordHash as string,
        createdAt: u.createdAt && !Number.isNaN(new Date(u.createdAt).getTime()) ? new Date(u.createdAt) : new Date(),
      }).onConflictDoNothing();
    }
    for (const { interview, ownerId } of interviews) {
      await tx.insert(interviewsTable).values({ ...interviewRow(interview, ownerId), createdAt: new Date(interview.updatedAt) }).onConflictDoNothing();
      if (interview.answers.length) {
        await tx.insert(answersTable).values(interview.answers.map((a, index) => answerRow(interview.id, a, index))).onConflictDoNothing();
      }
      for (const session of interview.sessions) await tx.insert(sessionsTable).values(sessionRow(interview.id, session)).onConflictDoNothing();
    }
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const file of [USERS_FILE, INTERVIEWS_FILE]) {
    if (fs.existsSync(file)) fs.renameSync(file, `${file}.imported-${stamp}.bak`);
  }
  logger.info({ users: users.length, interviews: interviews.length }, "Imported your old JSON data into PostgreSQL (the JSON files were kept as .bak backups)");
}
