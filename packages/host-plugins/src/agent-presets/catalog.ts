import type { DatabaseSync } from 'node:sqlite';
import {
  type AgentPreset,
  type AgentPresetInput,
  agentPresetInputSchema,
} from '@workspace/protocol/host';

export function createAgentPresetCatalog(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_preset_revisions (
      id TEXT NOT NULL,
      version INTEGER NOT NULL,
      definition TEXT NOT NULL,
      PRIMARY KEY (id, version)
    );
    CREATE TABLE IF NOT EXISTS agent_preset_preferences (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      default_preset_id TEXT
    );
  `);
  const preferences = db.prepare(
    'SELECT default_preset_id FROM agent_preset_preferences WHERE singleton = 1',
  );
  const setDefault = db.prepare(`
    INSERT INTO agent_preset_preferences VALUES (1, ?)
    ON CONFLICT(singleton) DO UPDATE SET default_preset_id = excluded.default_preset_id
  `);

  const selectLatestRevision = db.prepare(
    'SELECT * FROM agent_preset_revisions WHERE id = ? ORDER BY version DESC LIMIT 1',
  );
  const selectRevision = db.prepare(
    'SELECT * FROM agent_preset_revisions WHERE id = ? AND version = ?',
  );
  const selectLatestPresets = db.prepare(`
    SELECT r.* FROM agent_preset_revisions r
    JOIN (SELECT id, MAX(version) AS version FROM agent_preset_revisions GROUP BY id) newest
    USING (id, version)
    ORDER BY r.rowid
  `);
  const insertRevision = db.prepare(`
    INSERT OR IGNORE INTO agent_preset_revisions (id, version, definition)
    VALUES (?, ?, ?)
  `);

  function decodeRevision(row: Record<string, unknown>): AgentPreset {
    return {
      id: String(row.id),
      version: Number(row.version),
      ...agentPresetInputSchema.parse(JSON.parse(String(row.definition))),
    };
  }

  function create(definition: AgentPresetInput): AgentPreset {
    const id = crypto.randomUUID();
    insertRevision.run(id, 1, JSON.stringify(definition));
    return { ...definition, id, version: 1 };
  }

  return {
    initializeDefault(load: () => AgentPresetInput) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!preferences.get()) {
          setDefault.run(create(load()).id);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    defaultId(): string | null {
      const id = preferences.get()?.default_preset_id;
      return typeof id === 'string' ? id : null;
    },
    saveDefault(id: string | null): boolean {
      if (id !== null && !selectLatestRevision.get(id)) {
        return false;
      }
      setDefault.run(id);
      return true;
    },
    list: () => selectLatestPresets.all().map(decodeRevision),
    get(id: string, version?: number) {
      const row =
        version === undefined ? selectLatestRevision.get(id) : selectRevision.get(id, version);
      if (row) {
        return decodeRevision(row);
      }
    },
    create,
    revise(id: string, version: number, definition: AgentPresetInput): AgentPreset | undefined {
      // Revisions are contiguous. A stale write conflicts with the existing successor.
      const nextVersion = version + 1;
      const result = insertRevision.run(id, nextVersion, JSON.stringify(definition));
      if (result.changes) {
        return { ...definition, id, version: nextVersion };
      }
    },
  };
}
