import type { DatabaseSync } from 'node:sqlite';
import type {
  CombatRecordStats,
  JobErrorCode,
  JobState,
  JobStep,
  RecentPlayerSummary,
} from '@mw4trackstats/shared';

export interface JobRecord {
  id: string;
  normalizedId: string;
  activisionId: string;
  state: JobState;
  step: JobStep;
  errorCode: JobErrorCode | null;
  errorMessage: string | null;
  result: CombatRecordStats | null;
  xSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StatsRepository {
  getFresh(normalizedId: string, now?: Date): CombatRecordStats | null;
  getLatest(normalizedId: string): CombatRecordStats | null;
  upsert(stats: CombatRecordStats): void;
  deleteByNormalizedId(normalizedId: string): CombatRecordStats | null;
  listRecent(limit?: number): RecentPlayerSummary[];
}

export interface JobRepository {
  create(params: {
    id: string;
    normalizedId: string;
    activisionId: string;
    xSessionId?: string | null;
  }): JobRecord;
  findById(jobId: string): JobRecord | null;
  findActiveByNormalizedId(normalizedId: string): JobRecord | null;
  findNextQueued(excludeBuckets?: ReadonlySet<string>): JobRecord | null;
  markRunning(jobId: string, step: JobStep): JobRecord | null;
  updateStep(jobId: string, step: JobStep): JobRecord | null;
  complete(jobId: string, stats: CombatRecordStats): JobRecord | null;
  fail(jobId: string, errorCode: JobErrorCode, errorMessage: string): JobRecord | null;
  getQueuePosition(jobId: string): number;
  countPending(): number;
  recoverInterruptedJobs(): number;
}

interface PlayerStatsRow {
  normalized_id: string;
  activision_id: string;
  stats_json: string;
  fetched_at: string;
  expires_at: string;
  updated_at: string;
}

interface LookupJobRow {
  id: string;
  normalized_id: string;
  activision_id: string;
  state: JobState;
  step: JobStep;
  error_code: JobErrorCode | null;
  error_message: string | null;
  result_json: string | null;
  x_session_id: string | null;
  created_at: string;
  updated_at: string;
}

function parseStatsRow(row: PlayerStatsRow | undefined): CombatRecordStats | null {
  if (!row) {
    return null;
  }
  return JSON.parse(row.stats_json) as CombatRecordStats;
}

function parseJobRow(row: LookupJobRow | undefined): JobRecord | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    normalizedId: row.normalized_id,
    activisionId: row.activision_id,
    state: row.state,
    step: row.step,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    result: row.result_json ? (JSON.parse(row.result_json) as CombatRecordStats) : null,
    xSessionId: row.x_session_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const STATS_MAX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class SqliteStatsRepository implements StatsRepository {
  constructor(private readonly db: DatabaseSync) {}

  private pruneExpiredRetention(nowMs = Date.now()): void {
    const cutoffIso = new Date(nowMs - STATS_MAX_RETENTION_MS).toISOString();
    this.db
      .prepare(
        `DELETE FROM player_stats
         WHERE updated_at <= ?`,
      )
      .run(cutoffIso);
  }

  getFresh(normalizedId: string, now = new Date()): CombatRecordStats | null {
    const row = this.db
      .prepare(
        `SELECT normalized_id, activision_id, stats_json, fetched_at, expires_at, updated_at
         FROM player_stats
         WHERE normalized_id = ? AND expires_at > ?
         LIMIT 1`,
      )
      .get(normalizedId, now.toISOString()) as PlayerStatsRow | undefined;

    return parseStatsRow(row);
  }

  getLatest(normalizedId: string): CombatRecordStats | null {
    const row = this.db
      .prepare(
        `SELECT normalized_id, activision_id, stats_json, fetched_at, expires_at, updated_at
         FROM player_stats
         WHERE normalized_id = ?
         LIMIT 1`,
      )
      .get(normalizedId) as PlayerStatsRow | undefined;

    return parseStatsRow(row);
  }

  upsert(stats: CombatRecordStats): void {
    const nowMs = Date.now();
    this.pruneExpiredRetention(nowMs);
    const nowIso = new Date(nowMs).toISOString();
    this.db
      .prepare(
        `INSERT INTO player_stats (
          normalized_id, activision_id, stats_json, fetched_at, expires_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(normalized_id) DO UPDATE SET
          activision_id = excluded.activision_id,
          stats_json = excluded.stats_json,
          fetched_at = excluded.fetched_at,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at`,
      )
      .run(
        stats.normalizedId,
        stats.activisionId,
        JSON.stringify(stats),
        stats.fetchedAt,
        stats.expiresAt,
        nowIso,
      );
  }

  deleteByNormalizedId(normalizedId: string): CombatRecordStats | null {
    const existing = this.getLatest(normalizedId);
    if (!existing) {
      return null;
    }
    this.db
      .prepare(
        `DELETE FROM player_stats
         WHERE normalized_id = ?`,
      )
      .run(normalizedId);
    return existing;
  }

  listRecent(limit = 8): RecentPlayerSummary[] {
    const safeLimit = Math.max(1, Math.min(25, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `SELECT normalized_id, activision_id, stats_json, fetched_at, expires_at, updated_at
         FROM player_stats
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(safeLimit) as unknown as PlayerStatsRow[];

    const nowMs = Date.now();
    return rows.map((row) => {
      const stats = JSON.parse(row.stats_json) as CombatRecordStats;
      return {
        activisionId: stats.activisionId,
        normalizedId: stats.normalizedId,
        season: stats.season,
        fetchedAt: stats.fetchedAt,
        expiresAt: stats.expiresAt,
        isFresh: Date.parse(stats.expiresAt) > nowMs,
        multiplayerKd: stats.modes.multiplayer.kdRatio,
        resurgenceKills: stats.modes.resurgence.kills,
        dmzExfils: stats.modes.dmz.successfulExfils,
      };
    });
  }
}

const TERMINAL_JOB_RETENTION_MS = 24 * 60 * 60 * 1000;

export class SqliteJobRepository implements JobRepository {
  constructor(private readonly db: DatabaseSync) {}

  private pruneOldTerminalJobs(nowMs = Date.now()): void {
    const cutoffIso = new Date(nowMs - TERMINAL_JOB_RETENTION_MS).toISOString();
    this.db
      .prepare(
        `DELETE FROM lookup_jobs
         WHERE state IN ('completed', 'failed') AND updated_at <= ?`,
      )
      .run(cutoffIso);
  }

  create(params: {
    id: string;
    normalizedId: string;
    activisionId: string;
    xSessionId?: string | null;
  }): JobRecord {
    const nowMs = Date.now();
    this.pruneOldTerminalJobs(nowMs);
    const nowIso = new Date(nowMs).toISOString();
    this.db
      .prepare(
        `INSERT INTO lookup_jobs (
          id, normalized_id, activision_id, state, step, error_code, error_message, result_json, x_session_id, created_at, updated_at
        ) VALUES (?, ?, ?, 'queued', 'queued', NULL, NULL, NULL, ?, ?, ?)`,
      )
      .run(
        params.id,
        params.normalizedId,
        params.activisionId,
        params.xSessionId ?? null,
        nowIso,
        nowIso,
      );

    const created = this.findById(params.id);
    if (!created) {
      throw new Error(`Failed to reload newly created job ${params.id}`);
    }
    return created;
  }

  findById(jobId: string): JobRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, normalized_id, activision_id, state, step, error_code, error_message, result_json, x_session_id, created_at, updated_at
         FROM lookup_jobs
         WHERE id = ?
         LIMIT 1`,
      )
      .get(jobId) as LookupJobRow | undefined;

    return parseJobRow(row);
  }

  findActiveByNormalizedId(normalizedId: string): JobRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, normalized_id, activision_id, state, step, error_code, error_message, result_json, x_session_id, created_at, updated_at
         FROM lookup_jobs
         WHERE normalized_id = ? AND state IN ('queued', 'running')
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(normalizedId) as LookupJobRow | undefined;

    return parseJobRow(row);
  }

  findNextQueued(excludeBuckets?: ReadonlySet<string>): JobRecord | null {
    if (!excludeBuckets || excludeBuckets.size === 0) {
      const row = this.db
        .prepare(
          `SELECT id, normalized_id, activision_id, state, step, error_code, error_message, result_json, x_session_id, created_at, updated_at
           FROM lookup_jobs
           WHERE state = 'queued'
           ORDER BY created_at ASC, rowid ASC
           LIMIT 1`,
        )
        .get() as LookupJobRow | undefined;

      return parseJobRow(row);
    }

    const rows = this.db
      .prepare(
        `SELECT id, normalized_id, activision_id, state, step, error_code, error_message, result_json, x_session_id, created_at, updated_at
         FROM lookup_jobs
         WHERE state = 'queued'
         ORDER BY created_at ASC, rowid ASC`,
      )
      .all() as unknown as LookupJobRow[];

    const matched = rows.find((row) => !excludeBuckets.has(row.x_session_id ?? 'server'));
    return parseJobRow(matched);
  }

  markRunning(jobId: string, step: JobStep): JobRecord | null {
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE lookup_jobs
         SET state = 'running', step = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(step, nowIso, jobId);
    return this.findById(jobId);
  }

  updateStep(jobId: string, step: JobStep): JobRecord | null {
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE lookup_jobs
         SET step = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(step, nowIso, jobId);
    return this.findById(jobId);
  }

  complete(jobId: string, stats: CombatRecordStats): JobRecord | null {
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE lookup_jobs
         SET state = 'completed', step = 'completed', result_json = ?, error_code = NULL, error_message = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(stats), nowIso, jobId);
    return this.findById(jobId);
  }

  fail(jobId: string, errorCode: JobErrorCode, errorMessage: string): JobRecord | null {
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE lookup_jobs
         SET state = 'failed', step = 'failed', error_code = ?, error_message = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(errorCode, errorMessage, nowIso, jobId);
    return this.findById(jobId);
  }

  getQueuePosition(jobId: string): number {
    const target = this.findById(jobId);
    if (!target || (target.state !== 'queued' && target.state !== 'running')) {
      return 0;
    }

    const activeRows = this.db
      .prepare(
        `SELECT id
         FROM lookup_jobs
         WHERE state IN ('queued', 'running')
         ORDER BY CASE WHEN state = 'running' THEN 0 ELSE 1 END, created_at ASC, rowid ASC`,
      )
      .all() as unknown as Array<{ id: string }>;

    const index = activeRows.findIndex((row) => row.id === jobId);
    return index >= 0 ? index + 1 : 0;
  }

  countPending(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM lookup_jobs
         WHERE state IN ('queued', 'running')`,
      )
      .get() as { count: number } | undefined;

    return row?.count ?? 0;
  }

  recoverInterruptedJobs(): number {
    const nowIso = new Date().toISOString();
    const res = this.db
      .prepare(
        `UPDATE lookup_jobs
         SET state = 'queued', step = 'queued', updated_at = ?
         WHERE state = 'running'`,
      )
      .run(nowIso);
    return Number(res.changes);
  }
}
