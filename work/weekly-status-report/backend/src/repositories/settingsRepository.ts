import type pg from "pg";
import {
  mergeSettings,
  parseSettingsPatch,
  type Settings,
  type SettingsPatch,
} from "../config/settings.js";
import { DEFAULT_SETTINGS } from "../config/settingsDefaults.js";

export interface SettingsRepository {
  load(): Promise<Settings>;
  update(patch: unknown): Promise<Settings>;
}

// The denylist holds personal names, so audit entries record only its size (FR-047).
function auditValue(key: string, value: unknown): unknown {
  return key === "nameDenylist" && Array.isArray(value) ? { entries: value.length } : value;
}

export function createSettingsRepository(pool: pg.Pool): SettingsRepository {
  async function readStored(q: Pick<pg.Pool, "query">): Promise<Map<string, unknown>> {
    const { rows } = await q.query<{ key: string; value: unknown }>(
      "SELECT key, value FROM setting",
    );
    return new Map(rows.map((r) => [r.key, r.value]));
  }

  return {
    async load() {
      return mergeSettings(await readStored(pool));
    },

    async update(input) {
      const patch: SettingsPatch = parseSettingsPatch(input);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const stored = await readStored(client);
        const before = mergeSettings(stored);
        const changes: Array<[string, unknown, unknown]> = [];
        const next = new Map(stored);

        for (const [key, raw] of Object.entries(patch)) {
          const value =
            key === "ragThresholds" ? { ...before.ragThresholds, ...(raw as object) } : raw;
          next.set(key, value);
          const old = before[key as keyof Settings];
          if (JSON.stringify(old) !== JSON.stringify(value)) changes.push([key, old, value]);
        }

        // Validate the merged result before anything is written.
        const after = mergeSettings(next);
        for (const [key, old, value] of changes) {
          await client.query(
            `INSERT INTO setting (key, value) VALUES ($1, $2::jsonb)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [key, JSON.stringify(value)],
          );
          await client.query(
            `INSERT INTO audit_entry (entity, entity_key, action, old_value, new_value)
             VALUES ('setting', $1, 'update', $2::jsonb, $3::jsonb)`,
            [key, JSON.stringify(auditValue(key, old)), JSON.stringify(auditValue(key, value))],
          );
        }
        await client.query("COMMIT");
        return after;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

export { DEFAULT_SETTINGS };
