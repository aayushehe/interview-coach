# Database (PostgreSQL)

Interview Coach stores everything in PostgreSQL: accounts, practice rooms, answers, sessions and reports.

## First-time setup (Windows)

```powershell
.\setup-database.ps1
.\start.ps1
```

`setup-database.ps1` finds PostgreSQL (or installs it with winget), creates the `interview_coach` database and a
`coach` user with a generated password, and writes `DATABASE_URL` into `artifacts\api-server\.env`.
The password never has to be typed or shared. Running the script again is safe.

The server creates its tables by itself on start (`api-server/src/lib/migrations.ts`).

## Moving your old data

If `artifacts/api-server/data/users.json` and `interviews.json` exist and the database is empty, they are imported
on the first start (accounts keep their old passwords). The files are then renamed to `*.imported-<time>.bak`
and kept as a backup.

## Look at your data

- pgAdmin (installed with PostgreSQL) or `psql -U coach -d interview_coach`
- Tables: `users`, `interviews`, `answers`, `sessions`

## Backup and restore

```powershell
pg_dump -U coach -h localhost -d interview_coach -f backup.sql
psql -U coach -h localhost -d interview_coach -f backup.sql
```

## Using a hosted PostgreSQL later

Put its connection string in `DATABASE_URL` (and set `AUTH_SECRET` to a long random text). Nothing else changes.

## Changing the tables

Edit `lib/db/src/schema/index.ts`, then add a NEW entry at the end of `MIGRATIONS` in
`artifacts/api-server/src/lib/migrations.ts` (never edit an old one) and restart the server.
