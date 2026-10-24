import { pool } from "@workspace/db";
import { importLegacyJson } from "./legacy-import";
import { logger } from "./logger";
import { runMigrations } from "./migrate";

/** Drizzle wraps the driver error, so the PostgreSQL error code can be one level down. */
export function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } } | undefined;
  return e?.cause?.code ?? e?.code;
}

/** Turns low-level database errors into a sentence a person can act on. */
export function explainDatabaseError(error: unknown): string {
  const e = error as { message?: string; cause?: { message?: string } } | undefined;
  switch (pgErrorCode(error)) {
    case "ECONNREFUSED":
    case "ETIMEDOUT":
    case "ENOTFOUND":
      return "PostgreSQL is not reachable. Is the PostgreSQL service running? (Windows: open Services and start 'postgresql-x64-16'.) If you have not set it up yet, run setup-database.ps1.";
    case "28P01":
    case "28000":
      return "PostgreSQL rejected the user name or password in DATABASE_URL (artifacts/api-server/.env). Run setup-database.ps1 again to fix it.";
    case "3D000":
      return "The database named in DATABASE_URL does not exist. Run setup-database.ps1 to create it.";
    default:
      return e?.cause?.message ?? e?.message ?? "Unknown database error.";
  }
}

export async function initDatabase(): Promise<void> {
  // an idle connection can break when PostgreSQL restarts; log it instead of crashing the server
  pool.on("error", (error) => logger.error({ err: error }, "Database connection error"));
  await pool.query("SELECT 1");
  await runMigrations();
  await importLegacyJson();
  logger.info("Database is ready");
}
