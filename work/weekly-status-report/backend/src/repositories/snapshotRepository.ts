import type pg from "pg";
import type { Rag } from "../contract/index.js";

export const NO_EPIC_KEY = "";

export interface SnapshotEpic {
  epicKey: string;
  name: string;
  rag: Rag;
  basis: "points" | "count";
  totalUnits: number;
  doneUnits: number;
  // Unrounded, so deltas are computed from exact values (DEF-07).
  percentComplete: number;
  blockerCount: number;
}

export interface Snapshot {
  weekStart: string;
  jobId: number | null;
  overallRag: Rag;
  blockerCount: number;
  epics: SnapshotEpic[];
}

export interface SnapshotRepository {
  /** The most recent snapshot strictly before the given week, even if weeks were skipped. */
  findPrevious(weekStart: string): Promise<Snapshot | null>;
  /** Stores the week's snapshot, replacing any earlier one for the same week. */
  replace(snapshot: Snapshot): Promise<void>;
  /** The latest snapshots up to and including `upToWeek`, oldest first. */
  list(upToWeek: string, limit: number): Promise<Snapshot[]>;
}

interface SnapshotRow {
  week_start: string;
  job_id: string | null;
  overall_rag: Rag;
  blocker_count: number;
}
interface EpicRow {
  week_start: string;
  epic_key: string;
  name: string;
  rag: Rag;
  basis: "points" | "count";
  total_units: string;
  done_units: string;
  percent_complete: string;
  blocker_count: number;
}

const WEEK = "to_char(week_start, 'YYYY-MM-DD') AS week_start";

function assemble(rows: SnapshotRow[], epics: EpicRow[]): Snapshot[] {
  return rows.map((r) => ({
    weekStart: r.week_start,
    jobId: r.job_id === null ? null : Number(r.job_id),
    overallRag: r.overall_rag,
    blockerCount: r.blocker_count,
    epics: epics
      .filter((e) => e.week_start === r.week_start)
      .map((e) => ({
        epicKey: e.epic_key,
        name: e.name,
        rag: e.rag,
        basis: e.basis,
        totalUnits: Number(e.total_units),
        doneUnits: Number(e.done_units),
        percentComplete: Number(e.percent_complete),
        blockerCount: e.blocker_count,
      })),
  }));
}

export function createSnapshotRepository(pool: pg.Pool): SnapshotRepository {
  async function load(where: string, params: unknown[], tail: string): Promise<Snapshot[]> {
    const { rows } = await pool.query<SnapshotRow>(
      `SELECT ${WEEK}, job_id, overall_rag, blocker_count FROM snapshot WHERE ${where} ${tail}`,
      params,
    );
    if (rows.length === 0) return [];
    const { rows: epics } = await pool.query<EpicRow>(
      `SELECT ${WEEK}, epic_key, name, rag, basis, total_units, done_units, percent_complete, blocker_count
         FROM snapshot_epic WHERE week_start = ANY($1::date[]) ORDER BY epic_key`,
      [rows.map((r) => r.week_start)],
    );
    return assemble(rows, epics);
  }

  return {
    async findPrevious(weekStart) {
      const found = await load(
        "week_start < $1::date",
        [weekStart],
        "ORDER BY week_start DESC LIMIT 1",
      );
      return found[0] ?? null;
    },

    async list(upToWeek, limit) {
      const found = await load(
        "week_start <= $1::date",
        [upToWeek, limit],
        "ORDER BY week_start DESC LIMIT $2",
      );
      return found.reverse();
    },

    async replace(snapshot) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM snapshot WHERE week_start = $1::date", [
          snapshot.weekStart,
        ]);
        await client.query(
          `INSERT INTO snapshot (week_start, job_id, overall_rag, blocker_count)
           VALUES ($1::date, $2, $3, $4)`,
          [snapshot.weekStart, snapshot.jobId, snapshot.overallRag, snapshot.blockerCount],
        );
        for (const e of snapshot.epics) {
          await client.query(
            `INSERT INTO snapshot_epic (week_start, epic_key, name, rag, basis, total_units,
                                        done_units, percent_complete, blocker_count)
             VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              snapshot.weekStart,
              e.epicKey,
              e.name,
              e.rag,
              e.basis,
              e.totalUnits,
              e.doneUnits,
              e.percentComplete,
              e.blockerCount,
            ],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
