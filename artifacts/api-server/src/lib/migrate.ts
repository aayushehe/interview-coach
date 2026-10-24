import { pool } from "@workspace/db";
import { logger } from "./logger";
import { MIGRATIONS } from "./migrations";

/** Creates or updates the tables. Safe to run on every start: finished migrations are skipped. */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(727274)"); // two servers starting together must not collide
    await client.query("CREATE TABLE IF NOT EXISTS app_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await client.query<{ id: string }>("SELECT id FROM app_migrations")).rows.map((row) => row.id));
    for (const migration of MIGRATIONS) {
      if (done.has(migration.id)) continue;
      for (const statement of migration.sql.split("--> statement-breakpoint")) {
        if (statement.trim()) await client.query(statement);
      }
      await client.query("INSERT INTO app_migrations (id) VALUES ($1)", [migration.id]);
      logger.info({ migration: migration.id }, "Applied database migration");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
