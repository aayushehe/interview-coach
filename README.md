# AI Interview Coach

A practice app for placement interviews. You record (or type) answers to interview questions, and the app
transcribes them, scores them, measures how you speak (pace, pauses, filler words) and gives a written review
and a PDF report. Everything is saved per account in PostgreSQL.

## What it does

- **Accounts**: sign up and log in. Passwords are stored as scrypt hashes, sessions use a signed token.
  Every user only sees their own data.
- **Practice rooms**: pick a role, company, level and topic. Optional resume and job description.
- **5-question sessions**: answer by voice or by typing. Voice answers are transcribed with Groq Whisper.
- **Delivery measurements** (voice answers only): words per minute, number of pauses, longest pause, filler words.
- **AI review per answer and per session**: scores for content, structure, confidence and delivery.
  If the AI is unavailable or rate-limited, a fallback review is built from your measured numbers.
- **Core CS question bank**: DBMS, OS, Computer Networks, OOP and a Mixed set.
  The question bank does not use your resume or job description; AI-generated questions do.
- **Dashboard** and **PDF report** of a finished session.

## Tech stack

| Part | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite, Wouter, TanStack Query (port 5173) |
| Backend | Express 5 (port 8080) |
| AI | Groq (Whisper for speech-to-text, chat model for reviews) |
| Database | PostgreSQL with drizzle (`lib/db`) |
| Workspace | pnpm |

## Run it on Windows (PowerShell)

You need Node.js and pnpm. PostgreSQL is installed for you if it is missing.

```powershell
pnpm install --ignore-scripts
.\setup-database.ps1     # one time: installs/finds PostgreSQL, creates the database, writes DATABASE_URL
.\start.ps1              # starts backend and frontend and opens http://localhost:5173
```

Notes:

- `setup-database.ps1` asks for the PostgreSQL admin (`postgres`) password. If PostgreSQL is not installed, it
  can install PostgreSQL 16 with winget and you choose that password. The app itself uses a generated `coach`
  user; you never type its password.
- `start.ps1` refuses to start if `DATABASE_URL` is missing from `artifacts\api-server\.env`.
- If PowerShell blocks scripts, run `Set-ExecutionPolicy -Scope Process Bypass` once in that window.
- Old history from the JSON files (`artifacts/api-server/data`) is imported the first time the server starts.
- More about the database, backups and changing tables: see [DATABASE.md](DATABASE.md).

## Configuration

Copy `artifacts/api-server/.env.example` to `artifacts/api-server/.env`. Never commit `.env`.

| Variable | Needed | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | Written by `setup-database.ps1` |
| `GROQ_API_KEY` | for AI and voice | Your own Groq key. Without it the app falls back where it can |
| `GROQ_MODEL` | no | Chat model name |
| `PORT` | no | Backend port, default 8080 |
| `AUTH_SECRET` | deployment only | Long random text (16+ characters). Locally a secret file is created automatically |

## Project layout

```
artifacts/api-server        Express API (routes, auth, question bank, storage, migrations)
artifacts/interview-coach   React frontend
lib/db                      drizzle schema and database connection
setup-database.ps1          one-time database setup (Windows)
start.ps1                   starts both servers (Windows)
DATABASE.md                 database notes
```

## Status

**Confirmed on a real Windows PC with Chrome:** database setup script, one-command start, account login,
a full 5-question session, report, PDF download, Dashboard.

**Partly tested:** installing PostgreSQL through winget. It worked in one run that had to be repaired by hand
(the admin password was reset). It has not been tried on a clean PC.

**Planned, not built yet:**

- Longest pause, WPM and level in the history view
- Automated tests
- Deployment guide (hosted PostgreSQL, `AUTH_SECRET`, HTTPS)
- Password reset

## Known limits

- The PDF cannot show Hindi (Devanagari) text.
- The question bank ignores the resume and job description.
- Scanned (image-only) PDF resumes cannot be read.
- The free Groq plan has per-minute token limits; the app retries and then uses the fallback review.
- There is no password reset yet.
