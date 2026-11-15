import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AgentPreset, SessionSummary } from '@workspace/protocol/host';
import {
  type AccessMode,
  type RunSettings,
  accessModeSchema,
  defaultModelSchema,
  runSettingsSchema,
  workspaceSchema,
} from '@workspace/protocol/host';
import { createAgentPresetCatalog } from '../agent-presets/catalog.js';
import { resolveFolder } from './folders.js';

const tables = `
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, title TEXT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    preset_id TEXT NOT NULL, preset_version INTEGER NOT NULL,
    model_id TEXT NOT NULL, effort TEXT NOT NULL, access_mode TEXT NOT NULL,
    model_revision INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (preset_id, preset_version) REFERENCES agent_preset_revisions(id, version)
  );
  CREATE TABLE IF NOT EXISTS model_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL
  );
`;

type RegisteredWorkspace = { id: string; name: string; path: string };

export function workspaceCatalogPath(databasePath: string) {
  return `${databasePath}.catalog`;
}

export function openWorkspaceCatalog(catalogPath: string) {
  const db = new DatabaseSync(catalogPath);
  try {
    return { catalog: createWorkspaceCatalog(db), close: () => db.close() };
  } catch (error) {
    db.close();
    throw error;
  }
}

export function createWorkspaceCatalog(db: DatabaseSync) {
  const presets = createAgentPresetCatalog(db);
  db.exec(tables);

  const readPreferences = db.prepare('SELECT value FROM model_preferences WHERE id = 1');
  const writePreferences = db.prepare(
    'INSERT INTO model_preferences VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value',
  );

  const selectWorkspaces = db.prepare('SELECT * FROM workspaces ORDER BY rowid');
  const selectSessions = db.prepare('SELECT * FROM sessions ORDER BY rowid DESC');
  const selectWorkspaceByPath = db.prepare('SELECT * FROM workspaces WHERE path = ?');
  const insertWorkspace = db.prepare('INSERT OR IGNORE INTO workspaces VALUES (?, ?, ?)');
  const selectWorkspaceById = db.prepare('SELECT * FROM workspaces WHERE id = ?');

  const insertSession = db.prepare(
    'INSERT INTO sessions (id, workspace_id, preset_id, preset_version, model_id, effort, access_mode) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
  );
  const updateRunSettings = db.prepare(
    'UPDATE sessions SET model_revision = model_revision + (model_id <> ?), model_id = ?, effort = ? WHERE id = ?',
  );
  const selectContextModel = db.prepare(
    'SELECT model_id, model_revision FROM sessions WHERE id = ?',
  );
  const selectSession = db.prepare('SELECT * FROM sessions WHERE id = ?');
  const updateAccessMode = db.prepare('UPDATE sessions SET access_mode = ? WHERE id = ?');
  const selectSessionWorkspacePath = db.prepare(`SELECT w.path FROM sessions AS s
    JOIN workspaces AS w ON w.id = s.workspace_id
    WHERE s.id = ?`);
  const updateFirstTitle = db.prepare(
    'UPDATE sessions SET title = ? WHERE id = ? AND title IS NULL',
  );

  const getPreset = (row: Record<string, unknown>) =>
    presets.get(String(row.preset_id), Number(row.preset_version));

  function summary(row: Record<string, unknown>): SessionSummary {
    const preset = getPreset(row);
    if (!preset) {
      throw new Error('The stored agent preset revision is unavailable.');
    }

    return {
      id: String(row.id),
      title: typeof row.title === 'string' ? row.title : null,
      workspaceId: String(row.workspace_id),
      agentPresetId: preset.id,
      agentPresetName: preset.name,
      agentPresetVersion: preset.version,
      agentPresetCapabilities: preset.capabilities,
      accessMode: accessModeSchema.parse(row.access_mode),
      runSettings: runSettingsSchema.parse({ model: row.model_id, effort: row.effort }),
    };
  }

  return {
    presets,
    defaultModel(): string | null {
      const row = readPreferences.get();
      if (!row) {
        return null;
      }

      const value: unknown = JSON.parse(String(row.value));
      const model =
        value && typeof value === 'object' && 'defaultModel' in value
          ? value.defaultModel
          : undefined;
      return defaultModelSchema.parse(model);
    },
    saveDefaultModel(defaultModel: string | null) {
      writePreferences.run(JSON.stringify({ defaultModel }));
    },
    list: () => ({
      workspaces: selectWorkspaces.all().map((row) => workspaceSchema.parse(row)),
      sessions: selectSessions.all().map(summary),
    }),
    add(this: void, folder: string) {
      const inserted = insertWorkspace.run(
        crypto.randomUUID(),
        path.basename(folder) || folder,
        folder,
      );
      return {
        workspace: workspaceSchema.parse(selectWorkspaceByPath.get(folder)),
        created: inserted.changes > 0,
      };
    },
    find(id: string) {
      const row = selectWorkspaceById.get(id);
      return row ? workspaceSchema.parse(row) : undefined;
    },
    async canStartSession(workspace: RegisteredWorkspace) {
      return (await resolveFolder(workspace.path).catch(() => null)) === workspace.path;
    },
    createSession(
      workspaceId: string,
      preset: AgentPreset,
      id: string,
      settings: RunSettings,
      accessMode: AccessMode = 'read-only',
    ): SessionSummary {
      insertSession.run(
        id,
        workspaceId,
        preset.id,
        preset.version,
        settings.model,
        settings.effort,
        accessMode,
      );
      const row = selectSession.get(id);
      if (!row) {
        throw new Error('The new session could not be loaded.');
      }
      return summary(row);
    },
    findSession(id: string) {
      const row = selectSession.get(id);
      if (row) {
        return summary(row);
      }
    },
    setRunSettings(id: string, settings: RunSettings) {
      return updateRunSettings.run(settings.model, settings.model, settings.effort, id).changes > 0;
    },
    contextModel(id: string) {
      const row = selectContextModel.get(id);
      return row
        ? { model: String(row.model_id), revision: Number(row.model_revision) }
        : undefined;
    },
    sessionPreset(id: string) {
      const row = selectSession.get(id);
      if (row) {
        return getPreset(row);
      }
    },
    sessionAccessMode(this: void, id: string) {
      const row = selectSession.get(id);
      return row ? accessModeSchema.parse(row.access_mode) : undefined;
    },
    setAccessMode(id: string, mode: AccessMode) {
      return updateAccessMode.run(mode, id).changes > 0;
    },
    workspaceRootForSession(this: void, id: string) {
      const value = selectSessionWorkspacePath.get(id)?.path;
      return typeof value === 'string' ? value : undefined;
    },
    setFirstTitle: (id: string, value: string) => updateFirstTitle.run(value, id),
  };
}
