import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {
  type TrajectoryModelInput,
  type TrajectoryModelInputResponse,
  type TrajectoryPage,
  type TrajectoryRecord,
  type TrajectoryRequest,
  type TrajectoryStatus,
  conversationUsageSchema,
  matchesRecord,
  trajectoryModelInputResponseSchema,
  trajectoryRecordSchema,
  trajectoryStatusSchema,
} from '@workspace/protocol/host';

function prepareInputEstimate(db: DatabaseSync) {
  // A byte-based estimate of the stored text and JSON, independent of provider usage.
  return db.prepare(`
    SELECT (coalesce(octet_length(prompt.value) - 2, 0) + 3) / 4 AS systemPrompt,
           (octet_length(tools.value) - 2 + 3) / 4 AS tools,
           (coalesce((
             SELECT sum(octet_length(message.value))
             FROM json_each(input.message_hashes) AS item
             JOIN trajectory_input_content AS message ON message.hash = item.value
           ), 0) + 3) / 4 AS messages
    FROM trajectory_model_input AS input
    LEFT JOIN trajectory_input_content AS prompt ON prompt.hash = input.prompt_hash
    JOIN trajectory_input_content AS tools ON tools.hash = input.tools_hash
    WHERE input.session_id = ? AND input.submission_id = ? AND input.model_id = ?
  `);
}

function preparePageQueries(db: DatabaseSync) {
  db.function('trajectory_record_matches', { deterministic: true }, (value, query) => {
    const record = trajectoryRecordSchema.parse(JSON.parse(String(value)));
    return Number(matchesRecord(record, String(query)));
  });
  const selectPage = db.prepare(`
    WITH ordered AS (
      SELECT *,
        row_number() OVER (ORDER BY sequence) AS turn_number,
        coalesce(sum((
          SELECT count(*) FROM trajectory_record r
          WHERE r.session_id = t.session_id AND r.submission_id = t.submission_id
            AND json_extract(r.value, '$.kind') = 'assistant'
            AND json_extract(r.value, '$.compactionId') IS NULL
        )) OVER (ORDER BY sequence ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)
          AS preceding_models
      FROM trajectory_turn t WHERE session_id = :session
    )
    SELECT * FROM ordered t
    WHERE t.sequence < :before
      AND (:query = '' OR instr('turn ' || t.turn_number, :query) > 0 OR EXISTS (
        SELECT 1 FROM trajectory_record r
        WHERE r.session_id = t.session_id AND r.submission_id = t.submission_id
          AND json_extract(r.value, '$.compactionId') IS NULL
          AND trajectory_record_matches(r.value, :query)
      ) OR EXISTS (
        SELECT 1 FROM (
          SELECT t.preceding_models + row_number() OVER (ORDER BY r.sequence) AS number
          FROM trajectory_record r
          WHERE r.session_id = t.session_id AND r.submission_id = t.submission_id
            AND json_extract(r.value, '$.kind') = 'assistant'
            AND json_extract(r.value, '$.compactionId') IS NULL
        ) WHERE instr('request #' || number, :query) > 0
      ))
    ORDER BY t.sequence DESC LIMIT :limit
  `);
  const selectTurnRecords = db.prepare(
    'SELECT submission_id, value FROM trajectory_record WHERE session_id = ? AND submission_id = ? ORDER BY sequence',
  );
  return { selectPage, selectTurnRecords };
}

function initializeTrajectory(db: DatabaseSync) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS trajectory_turn (
      sequence INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      submission_id TEXT NOT NULL,
      status TEXT NOT NULL,
      settled_at TEXT,
      error TEXT,
      UNIQUE (session_id, submission_id)
    );
    CREATE TABLE IF NOT EXISTS trajectory_record (
      sequence INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      submission_id TEXT NOT NULL,
      record_id TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE (session_id, submission_id, record_id),
      FOREIGN KEY (session_id, submission_id)
        REFERENCES trajectory_turn (session_id, submission_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS trajectory_input_content (
      hash TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trajectory_model_input (
      sequence INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      submission_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      prompt_hash TEXT,
      message_hashes TEXT NOT NULL,
      tools_hash TEXT NOT NULL,
      UNIQUE (session_id, submission_id, model_id),
      FOREIGN KEY (session_id, submission_id)
        REFERENCES trajectory_turn (session_id, submission_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS trajectory_turn_session_sequence
      ON trajectory_turn(session_id, sequence);
  `);
  db.exec(`
    UPDATE trajectory_record SET value = json_set(value, '$.status', 'interrupted')
    WHERE json_extract(value, '$.kind') = 'compaction'
      AND json_extract(value, '$.status') = 'in-progress'
  `);
}

export function createTrajectoryStore(db: DatabaseSync) {
  const generation = crypto.randomUUID();
  const revisions = new Map<string, number>();

  const changed = (sessionId: string) =>
    revisions.set(sessionId, (revisions.get(sessionId) ?? 0) + 1);

  initializeTrajectory(db);

  const insertTurnIfMissing = db.prepare(
    "INSERT OR IGNORE INTO trajectory_turn (session_id, submission_id, status) VALUES (?, ?, 'in-progress')",
  );
  const updateTurnSettlement = db.prepare(
    'UPDATE trajectory_turn SET status = ?, settled_at = ?, error = ? WHERE session_id = ? AND submission_id = ?',
  );
  const selectRecord = db.prepare(
    'SELECT value FROM trajectory_record WHERE session_id = ? AND submission_id = ? AND record_id = ?',
  );
  const upsertRecord = db.prepare(`
    INSERT INTO trajectory_record (session_id, submission_id, record_id, value) VALUES (?, ?, ?, ?)
    ON CONFLICT (session_id, submission_id, record_id) DO UPDATE SET value = excluded.value
  `);

  const { selectPage, selectTurnRecords } = preparePageQueries(db);
  const summarizeUsage = db.prepare(`
    WITH records AS (
      SELECT json_extract(value, '$.kind') AS kind,
             json_extract(value, '$.durationMs') AS duration,
             json_extract(value, '$.usage.input') AS input,
             json_extract(value, '$.usage.output') AS output,
             json_extract(value, '$.usage.cacheRead') AS cache_read,
             json_extract(value, '$.usage.cacheWrite') AS cache_write,
             json_extract(value, '$.usage.totalTokens') AS tokens,
             round((unixepoch(json_extract(value, '$.firstOutputAt'), 'subsec') -
                    unixepoch(json_extract(value, '$.timestamp'), 'subsec')) * 1000) AS first_output
      FROM trajectory_record
      WHERE session_id = ? AND json_extract(value, '$.kind') IN ('assistant', 'tool')
    ), measured AS (
      SELECT *, kind = 'assistant' AND first_output >= 0 AND duration >= first_output AS timed
      FROM records
    )
    SELECT
      (SELECT count(*) FROM trajectory_turn WHERE session_id = ?) AS turns,
      count(*) FILTER (WHERE kind = 'assistant') AS steps,
      sum(duration) FILTER (WHERE kind = 'assistant') AS modelMs,
      sum(duration) FILTER (WHERE kind = 'tool') AS toolMs,
      avg(first_output) FILTER (WHERE timed) AS averageFirstOutputMs,
      1000.0 * sum(output) FILTER (WHERE timed AND duration > first_output AND output > 0)
        / sum(duration - first_output) FILTER (WHERE timed AND duration > first_output AND output > 0)
        AS outputTokensPerSecond,
      coalesce(sum(tokens) FILTER (WHERE kind = 'assistant'), 0) AS tokens,
      coalesce(sum(input) FILTER (WHERE kind = 'assistant'), 0) AS input,
      coalesce(sum(output) FILTER (WHERE kind = 'assistant'), 0) AS output,
      coalesce(sum(cache_read) FILTER (WHERE kind = 'assistant'), 0) AS cacheRead,
      coalesce(sum(cache_write) FILTER (WHERE kind = 'assistant'), 0) AS cacheWrite
    FROM measured
  `);
  const selectCompaction = db.prepare(`
    SELECT sequence, json_extract(value, '$.status') AS status
    FROM trajectory_record WHERE session_id = ?
      AND json_extract(value, '$.kind') = 'compaction'
      AND json_extract(value, '$.status') = ?
    ORDER BY sequence DESC LIMIT 1
  `);
  const selectContextSample = db.prepare(`
    SELECT submission_id, record_id,
           json_extract(value, '$.contextSample.inputTokens') AS input_tokens,
           json_extract(value, '$.contextSample.contextWindow') AS context_window
    FROM trajectory_record WHERE session_id = ? AND sequence > ?
      AND json_extract(value, '$.contextSample.model') = ?
      AND json_extract(value, '$.contextSample.revision') = ?
      AND json_extract(value, '$.contextSample.inputTokens') IS NOT NULL
    ORDER BY sequence DESC LIMIT 1
  `);

  // Store identical request inputs once and reference them by hash.
  const storeContent = db.prepare(
    'INSERT OR IGNORE INTO trajectory_input_content (hash, value) VALUES (?, ?)',
  );
  const readContent = db.prepare('SELECT value FROM trajectory_input_content WHERE hash = ?');
  const readMessages = db.prepare(`
    SELECT content.value,
           content.hash || ':' || ROW_NUMBER() OVER (PARTITION BY content.hash ORDER BY item.key) AS id
    FROM json_each(?) AS item
    JOIN trajectory_input_content AS content ON content.hash = item.value
    ORDER BY item.key
  `);
  const saveInput = db.prepare(`
    INSERT INTO trajectory_model_input (session_id, submission_id, model_id, prompt_hash, message_hashes, tools_hash)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (session_id, submission_id, model_id) DO UPDATE SET
      prompt_hash = excluded.prompt_hash, message_hashes = excluded.message_hashes, tools_hash = excluded.tools_hash
  `);
  const readInput = db.prepare(
    'SELECT prompt_hash, message_hashes, tools_hash FROM trajectory_model_input WHERE session_id = ? AND submission_id = ? AND model_id = ?',
  );
  const estimateInput = prepareInputEstimate(db);
  const previousPrompt = db.prepare(
    `SELECT input.prompt_hash FROM trajectory_model_input AS input
     LEFT JOIN trajectory_record AS record ON record.session_id = input.session_id
       AND record.submission_id = input.submission_id AND record.record_id = input.model_id
     WHERE input.session_id = ? AND coalesce(json_extract(record.value, '$.purpose'), 'agent') = 'agent'
     ORDER BY input.sequence DESC LIMIT 1`,
  );

  function putContent(value: unknown) {
    const json = JSON.stringify(value);
    const hash = createHash('sha256').update(json).digest('hex');
    storeContent.run(hash, json);
    return hash;
  }

  function getContent(hash: string): unknown {
    const row = readContent.get(hash);
    return row ? JSON.parse(String(row.value)) : undefined;
  }

  function decodeTurn(row: Record<string, SQLOutputValue>): TrajectoryRequest {
    return {
      id: String(row.submission_id),
      status: trajectoryStatusSchema.parse(row.status),
      settledAt: typeof row.settled_at === 'string' ? row.settled_at : undefined,
      error: typeof row.error === 'string' ? row.error : undefined,
      records: [],
    };
  }

  function appendRecord(request: TrajectoryRequest, value: unknown) {
    const record = trajectoryRecordSchema.parse(JSON.parse(String(value)));
    if (
      (record.kind === 'assistant' || record.kind === 'tool' || record.kind === 'compaction') &&
      record.status === 'in-progress' &&
      request.status !== 'in-progress'
    ) {
      record.status = request.status === 'completed' ? 'unavailable' : request.status;
    }
    if (record.kind === 'system' && record.initial) {
      request.records.unshift(record);
    } else if (record.kind === 'user') {
      const first = request.records.at(0);
      request.records.splice(first?.kind === 'system' && first.initial ? 1 : 0, 0, record);
    } else {
      request.records.push(record);
    }
  }

  return {
    revision(sessionId: string) {
      return `${generation}:${revisions.get(sessionId) ?? 0}`;
    },
    ensure(sessionId: string, submissionId: string) {
      if (insertTurnIfMissing.run(sessionId, submissionId).changes) {
        changed(sessionId);
      }
    },
    settle(
      sessionId: string,
      submissionId: string,
      status: TrajectoryStatus,
      timestamp: string,
      error?: string,
    ) {
      insertTurnIfMissing.run(sessionId, submissionId);
      updateTurnSettlement.run(status, timestamp, error ?? null, sessionId, submissionId);
      changed(sessionId);
    },
    get(sessionId: string, submissionId: string, recordId: string): TrajectoryRecord | undefined {
      const row = selectRecord.get(sessionId, submissionId, recordId);
      return row ? trajectoryRecordSchema.parse(JSON.parse(String(row.value))) : undefined;
    },
    put(sessionId: string, submissionId: string, record: TrajectoryRecord) {
      insertTurnIfMissing.run(sessionId, submissionId);
      upsertRecord.run(sessionId, submissionId, record.id, JSON.stringify(record));
      changed(sessionId);
    },
    putModelInput(
      sessionId: string,
      submissionId: string,
      modelId: string,
      timestamp: string,
      input: TrajectoryModelInput,
      observeSystemPrompt = true,
    ) {
      db.exec('BEGIN');
      try {
        insertTurnIfMissing.run(sessionId, submissionId);
        const previous = previousPrompt.get(sessionId);
        const promptHash = input.systemPrompt === undefined ? null : putContent(input.systemPrompt);
        const messageHashes = input.messages.map(putContent);

        saveInput.run(
          sessionId,
          submissionId,
          modelId,
          promptHash,
          JSON.stringify(messageHashes),
          putContent(input.tools),
        );

        if (observeSystemPrompt && promptHash && previous?.prompt_hash !== promptHash) {
          const record: TrajectoryRecord = {
            kind: 'system',
            id: `system:${modelId}`,
            modelRequestId: modelId,
            initial: !previous,
            timestamp,
            text: previous ? 'System Prompt Updated' : 'Initial System Prompt',
          };
          upsertRecord.run(sessionId, submissionId, record.id, JSON.stringify(record));
        }

        db.exec('COMMIT');
        changed(sessionId);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    modelInput(
      this: void,
      sessionId: string,
      submissionId: string,
      modelId: string,
    ): TrajectoryModelInputResponse | undefined {
      const row = readInput.get(sessionId, submissionId, modelId);
      if (!row) {
        return undefined;
      }
      const messages = readMessages.all(String(row.message_hashes));

      return trajectoryModelInputResponseSchema.parse({
        systemPrompt: row.prompt_hash === null ? undefined : getContent(String(row.prompt_hash)),
        messages: messages.map(({ value }): unknown => JSON.parse(String(value))),
        messageIds: messages.map(({ id }) => id),
        tools: getContent(String(row.tools_hash)),
      });
    },
    usage(this: void, sessionId: string, selection?: { model: string; revision: number }) {
      const totals = summarizeUsage.get(sessionId, sessionId);
      if (!selection) {
        return conversationUsageSchema.parse(totals);
      }
      const active = selectCompaction.get(sessionId, 'in-progress');
      const boundary = selectCompaction.get(sessionId, 'completed')?.sequence ?? 0;
      const sample = active
        ? undefined
        : selectContextSample.get(sessionId, boundary, selection.model, selection.revision);
      const estimatedTokens = sample
        ? estimateInput.get(sessionId, String(sample.submission_id), String(sample.record_id))
        : undefined;
      const context = active
        ? { status: 'compacting' }
        : sample
          ? {
              status: 'available',
              model: selection.model,
              inputTokens: sample.input_tokens,
              contextWindow: sample.context_window,
              estimatedTokens,
            }
          : { status: 'unavailable' };
      return conversationUsageSchema.parse({ ...totals, context });
    },
    page(
      sessionId: string,
      before: number | undefined,
      query: string,
      limit: number,
    ): TrajectoryPage {
      const rows = selectPage.all({
        session: sessionId,
        before: before ?? Number.MAX_SAFE_INTEGER,
        query,
        limit: limit + 1,
      });
      const page = rows.slice(0, limit);
      const next = rows.length > limit ? Number(page.at(-1)?.sequence) : null;
      return {
        before: next,
        requests: page.reverse().map((row) => {
          const request = decodeTurn(row);
          for (const record of selectTurnRecords.all(sessionId, request.id)) {
            appendRecord(request, record.value);
          }
          return {
            request,
            turn: Number(row.turn_number),
            precedingModelRequests: Number(row.preceding_models),
          };
        }),
      };
    },
  };
}

export type TrajectoryStore = ReturnType<typeof createTrajectoryStore>;
