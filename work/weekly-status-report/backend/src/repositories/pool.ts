import pg from "pg";
import type { Logger } from "../logger.js";

export function createPool(connectionString: string, logger?: Logger): pg.Pool {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 2000, max: 10 });
  // Idle clients emit "error" when the database goes away; without a listener Node exits.
  pool.on("error", (err) => {
    logger?.warn({ err }, "idle database connection error");
  });
  return pool;
}

export function databaseCheck(pool: pg.Pool): () => Promise<void> {
  return async () => {
    await pool.query("select 1");
  };
}
