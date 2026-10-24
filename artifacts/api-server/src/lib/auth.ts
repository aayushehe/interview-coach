// Accounts: scrypt password hashes, HMAC-signed tokens, users stored in PostgreSQL (table "users").
// The signing secret comes from AUTH_SECRET in .env, or from api-server/data/auth-secret.key,
// which is created on first start (and is git-ignored).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { logger } from "./logger";
import { dbCountUsers, dbFindUserByEmail, dbFindUserById, dbInsertUser } from "./store";

export type PublicUser = { id: string; name: string; email: string };
type StoredUser = PublicUser & { passwordHash: string; createdAt: string };

const DATA_DIR = process.env.INTERVIEWS_FILE
  ? path.dirname(path.resolve(process.env.INTERVIEWS_FILE))
  : path.resolve(process.cwd(), "data");
const SECRET_FILE = path.join(DATA_DIR, "auth-secret.key");
const TOKEN_DAYS = 30;

/* ───────── secret ───────── */
function loadSecret(): Buffer {
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16) return Buffer.from(process.env.AUTH_SECRET, "utf-8");
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const saved = fs.readFileSync(SECRET_FILE, "utf-8").trim();
      if (saved.length >= 32) return Buffer.from(saved, "hex");
    }
  } catch (error) {
    logger.warn({ err: error }, "Could not read auth secret, creating a new one");
  }
  const fresh = crypto.randomBytes(32);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, fresh.toString("hex"), { encoding: "utf-8", mode: 0o600 });
  } catch (error) {
    logger.error({ err: error }, "Could not save auth secret. Logins will reset when the server restarts.");
  }
  return fresh;
}
const SECRET = loadSecret();

/* ───────── password hashing ───────── */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

const DUMMY_HASH = hashPassword("not-a-real-password"); // so unknown emails cost the same time as wrong passwords

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

/* ───────── tokens ───────── */
const b64u = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

export function signToken(userId: string, ttlDays = TOKEN_DAYS): string {
  const payload = b64u(JSON.stringify({ sub: userId, exp: Date.now() + ttlDays * 86_400_000 }));
  const sig = b64u(crypto.createHmac("sha256", SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as { sub?: unknown; exp?: unknown };
    if (typeof data.sub !== "string" || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data.sub;
  } catch {
    return null;
  }
}

/* ───────── user store (PostgreSQL) ───────── */
const toPublic = (u: { id: string; name: string; email: string }): PublicUser => ({ id: u.id, name: u.name, email: u.email });

export const normalizeEmail = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");
export const isValidEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

export const userCount = () => dbCountUsers();
export const findUserByEmail = (email: string) => dbFindUserByEmail(email);

/** Throws an error with code "23505" when the email is already taken (the database enforces it). */
export async function createUser(name: string, email: string, password: string): Promise<PublicUser> {
  const user = { id: crypto.randomUUID(), name, email, passwordHash: hashPassword(password) };
  await dbInsertUser(user);
  return toPublic(user);
}

/** Returns the user when the password matches, otherwise null (same cost either way). */
export async function checkLogin(email: string, password: string): Promise<PublicUser | null> {
  const user = await dbFindUserByEmail(email);
  const ok = verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  return user && ok ? toPublic(user) : null;
}

/* ───────── login throttling (in memory) ───────── */
const failures = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 8;
export const isThrottled = (key: string) => {
  const f = failures.get(key);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW_MS) { failures.delete(key); return false; }
  return f.count >= MAX_FAILURES;
};
export const recordFailure = (key: string) => {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else f.count += 1;
};
export const clearFailures = (key: string) => failures.delete(key);

/* ───────── express glue ───────── */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const userId = token ? verifyToken(token) : null;
    const user = userId ? await dbFindUserById(userId) : undefined;
    if (!user) {
      res.status(401).json({ error: "Please sign in again." });
      return;
    }
    res.locals.user = toPublic(user);
    next();
  } catch (error) {
    next(error);
  }
}

export const authUser = (res: Response): PublicUser => res.locals.user as PublicUser;
export const userIdOf = (res: Response): string => authUser(res).id;
