import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url }) : null;

afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!url)("core migrations", () => {
  it("creates all tables", async () => {
    const { rows } = await pool!.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const names = rows.map((r) => r.table_name);
    for (const t of [
      "report_job",
      "issue_history",
      "sync_state",
      "report_deck",
      "setting",
      "audit_entry",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("allows only one active job per week", async () => {
    const week = "2031-01-06";
    await pool!.query("DELETE FROM report_job WHERE week_start = $1", [week]);
    const insert = (status: string) =>
      pool!.query("INSERT INTO report_job (week_start, time_zone, status) VALUES ($1, 'UTC', $2)", [
        week,
        status,
      ]);
    await insert("queued");
    await expect(insert("running")).rejects.toMatchObject({ code: "23505" });
    await pool!.query("UPDATE report_job SET status = 'failed' WHERE week_start = $1", [week]);
    await insert("queued");
    await insert("failed");
    await pool!.query("DELETE FROM report_job WHERE week_start = $1", [week]);
  });

  it("rejects an unknown job status and maintains updated_at", async () => {
    await expect(
      pool!.query(
        "INSERT INTO report_job (week_start, time_zone, status) VALUES ('2031-02-03','UTC','bogus')",
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await pool!.query("DELETE FROM setting WHERE key = 'mig.test'");
    await pool!.query("INSERT INTO setting (key, value) VALUES ('mig.test', '1')");
    const before = await pool!.query("SELECT updated_at FROM setting WHERE key = 'mig.test'");
    await new Promise((r) => setTimeout(r, 15));
    await pool!.query("UPDATE setting SET value = '2' WHERE key = 'mig.test'");
    const after = await pool!.query("SELECT updated_at FROM setting WHERE key = 'mig.test'");
    expect(after.rows[0].updated_at.getTime()).toBeGreaterThan(before.rows[0].updated_at.getTime());
    await pool!.query("DELETE FROM setting WHERE key = 'mig.test'");
  });
});
