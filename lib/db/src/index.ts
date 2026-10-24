import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Run setup-database.ps1 once (it creates the PostgreSQL database and writes DATABASE_URL into artifacts/api-server/.env).",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
