import type pg from "pg";
import type { Rag } from "../contract/index.js";

export interface OverrideRecord {
  weekStart: string;
  scope: "overall" | "epic";
  epicKey: string | null;
  rag: Rag;
  reason: string;
}

export type OverrideChange = "created" | "updated" | "unchanged";

export interface OverrideRepository {
  list(weekStart: string): Promise<OverrideRecord[]>;
  /** Creates or changes an override and writes an audit entry when something changed. */
  upsert(override: OverrideRecord): Promise<OverrideChange>;
  /** Returns false when there was nothing to delete. */
  remove(weekStart: string, scope: "overall" | "epic", epicKey: string | null): Promise<boolean>;
}

interface Row {
  week_start: string;
  scope: "overall" | "epic";
  epic_key: string;
  rag: Rag;
  reason: string;
}

const COLUMNS = "to_char(week_start, 'YYYY-MM-DD') AS week_start, scope, epic_key, rag, reason";

const toRecord = (r: Row): OverrideRecord => ({
  weekStart: r.week_start,
  scope: r.scope,
  epicKey: r.scope === "overall" ? null : r.epic_key,
  rag: r.rag,
  reason: r.reason,
});

// The audit entry names the week and Epic key only; Jira summaries and people never appear.
const auditKey = (weekStart: string, scope: string, epicKey: string): string =>
  scope === "overall" ? `${weekStart}/overall` : `${weekStart}/epic/${epicKey}`;

export function createOverrideRepository(pool: pg.Pool): OverrideRepository {
  return {
    async list(weekStart) {
      const { rows } = await pool.query<Row>(
        `SELECT ${COLUMNS} FROM rag_override WHERE week_start = $1::date
         ORDER BY scope DESC, epic_key`,
        [weekStart],
      );
      return rows.map(toRecord);
    },

    async upsert(o) {
      const key = o.epicKey ?? "";
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<Row>(
          `SELECT ${COLUMNS} FROM rag_override
           WHERE week_start = $1::date AND scope = $2 AND epic_key = $3 FOR UPDATE`,
          [o.weekStart, o.scope, key],
        );
        const before = rows[0];
        if (before && before.rag === o.rag && before.reason === o.reason) {
          await client.query("ROLLBACK");
          return "unchanged";
        }
        await client.query(
          `INSERT INTO rag_override (week_start, scope, epic_key, rag, reason)
           VALUES ($1::date, $2, $3, $4, $5)
           ON CONFLICT (week_start, scope, epic_key)
           DO UPDATE SET rag = EXCLUDED.rag, reason = EXCLUDED.reason`,
          [o.weekStart, o.scope, key, o.rag, o.reason],
        );
        await client.query(
          `INSERT INTO audit_entry (entity, entity_key, action, old_value, new_value)
           VALUES ('rag_override', $1, $2, $3::jsonb, $4::jsonb)`,
          [
            auditKey(o.weekStart, o.scope, key),
            before ? "update" : "create",
            before ? JSON.stringify({ rag: before.rag, reason: before.reason }) : null,
            JSON.stringify({ rag: o.rag, reason: o.reason }),
          ],
        );
        await client.query("COMMIT");
        return before ? "updated" : "created";
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async remove(weekStart, scope, epicKey) {
      const key = epicKey ?? "";
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<Row>(
          `DELETE FROM rag_override WHERE week_start = $1::date AND scope = $2 AND epic_key = $3
           RETURNING ${COLUMNS}`,
          [weekStart, scope, key],
        );
        const gone = rows[0];
        if (gone) {
          await client.query(
            `INSERT INTO audit_entry (entity, entity_key, action, old_value, new_value)
             VALUES ('rag_override', $1, 'delete', $2::jsonb, NULL)`,
            [
              auditKey(weekStart, scope, key),
              JSON.stringify({ rag: gone.rag, reason: gone.reason }),
            ],
          );
        }
        await client.query("COMMIT");
        return gone !== undefined;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
