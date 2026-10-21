import type pg from "pg";
import type { StatusCategory } from "../contract/index.js";
import type { DerivedHistory } from "../jira/enrich.js";
import type { CachedHistory, HistoryStore, SyncCommit } from "../jira/sync.js";

interface StoredHistory {
  transitions: Array<{
    at: string;
    from: string;
    to: string;
    fromCategory: StatusCategory;
    toCategory: StatusCategory;
  }>;
  flagEvents: Array<{ at: string; flagged: boolean }>;
  pointChanges: Array<{ at: string; from: number | null; to: number | null }>;
}

function revive(stored: StoredHistory): DerivedHistory {
  return {
    transitions: stored.transitions.map((t) => ({ ...t, at: new Date(t.at) })),
    flagEvents: stored.flagEvents.map((e) => ({ ...e, at: new Date(e.at) })),
    pointChanges: stored.pointChanges.map((p) => ({ ...p, at: new Date(p.at) })),
  };
}

export function createHistoryRepository(pool: pg.Pool): HistoryStore {
  return {
    async lastSuccessAt(projectKey) {
      const { rows } = await pool.query<{ last_success_at: Date | null }>(
        "SELECT last_success_at FROM sync_state WHERE project_key = $1",
        [projectKey],
      );
      return rows[0]?.last_success_at ?? null;
    },

    async loadAll() {
      const { rows } = await pool.query<{
        issue_key: string;
        jira_updated: Date;
        history: StoredHistory;
      }>("SELECT issue_key, jira_updated, history FROM issue_history");
      return new Map<string, CachedHistory>(
        rows.map((r) => [r.issue_key, { jiraUpdated: r.jira_updated, history: revive(r.history) }]),
      );
    },

    async commit(change: SyncCommit) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const [key, entry] of change.upserts) {
          await client.query(
            `INSERT INTO issue_history (issue_key, jira_updated, history)
             VALUES ($1, $2, $3::jsonb)
             ON CONFLICT (issue_key) DO UPDATE
               SET jira_updated = EXCLUDED.jira_updated, history = EXCLUDED.history`,
            [key, entry.jiraUpdated, JSON.stringify(entry.history)],
          );
        }
        await client.query("DELETE FROM issue_history WHERE issue_key <> ALL($1::text[])", [
          [...change.liveKeys],
        ]);
        await client.query(
          `INSERT INTO sync_state (project_key, last_success_at, last_full_reconcile_at)
           VALUES ($1, $2, $2)
           ON CONFLICT (project_key) DO UPDATE
             SET last_success_at = EXCLUDED.last_success_at,
                 last_full_reconcile_at = EXCLUDED.last_full_reconcile_at`,
          [change.projectKey, change.startedAt],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
