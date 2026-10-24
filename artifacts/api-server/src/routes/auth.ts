import { Router, type IRouter } from "express";
import {
  authUser, checkLogin, clearFailures, createUser, findUserByEmail, isThrottled, isValidEmail,
  normalizeEmail, recordFailure, requireAuth, signToken, userCount,
} from "../lib/auth";
import { adoptOrphanInterviews } from "../lib/store";
import { pgErrorCode } from "../lib/db-init";

const router: IRouter = Router();

const cleanName = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 60) : "");
const passwordOk = (value: unknown): value is string => typeof value === "string" && value.length >= 6 && value.length <= 128;

const EMAIL_TAKEN = "An account with this email already exists. Please sign in.";

router.post("/auth/register", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = cleanName(body.name);
  const email = normalizeEmail(body.email);
  if (name.length < 2) { res.status(400).json({ error: "Please enter your name." }); return; }
  if (!isValidEmail(email)) { res.status(400).json({ error: "That email does not look right." }); return; }
  if (!passwordOk(body.password)) { res.status(400).json({ error: "Password must be 6 to 128 characters." }); return; }
  if (await findUserByEmail(email)) { res.status(409).json({ error: EMAIL_TAKEN }); return; }

  const firstAccount = (await userCount()) === 0;
  let user;
  try {
    user = await createUser(name, email, body.password);
  } catch (error) {
    if (pgErrorCode(error) === "23505") { res.status(409).json({ error: EMAIL_TAKEN }); return; } // two sign-ups at once
    throw error;
  }
  // Rooms that were saved before accounts existed belong to whoever signs up first.
  const adopted = firstAccount ? await adoptOrphanInterviews(user.id) : 0;
  res.status(201).json({ token: signToken(user.id), user, adopted });
});

router.post("/auth/login", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  const key = `${req.ip}|${email}`;
  if (isThrottled(key)) { res.status(429).json({ error: "Too many wrong attempts. Please wait a few minutes and try again." }); return; }
  const user = typeof body.password === "string" ? await checkLogin(email, body.password) : null;
  if (!user) {
    recordFailure(key);
    res.status(401).json({ error: "Email or password is wrong." });
    return;
  }
  clearFailures(key);
  res.json({ token: signToken(user.id), user });
});

router.get("/auth/me", requireAuth, (_req, res) => {
  res.json({ user: authUser(res) });
});

export default router;
