import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { CombatRecordStats } from '@mw4trackstats/shared';
import { openDatabase } from '../db/database.js';
import { SqliteJobRepository, SqliteStatsRepository } from '../db/repository.js';
import { buildMockCombatRecordModes } from '../providers/x/mockXProvider.js';

function makeSampleStats(overrides: Partial<CombatRecordStats> = {}): CombatRecordStats {
  const fetchedAt = overrides.fetchedAt ?? '2026-11-19T12:00:00.000Z';
  const expiresAt = overrides.expiresAt ?? '2026-11-19T12:30:00.000Z';
  return {
    activisionId: 'Operator#5745488',
    normalizedId: 'operator#5745488',
    parsedActivisionId: '#5745488',
    season: 'Season 01',
    sourceBotHandle: 'CODCombatRecord',
    replyTweetId: 'reply-1',
    imageUrl: null,
    localImagePath: '/api/images/00000000-0000-0000-0000-000000000001.png',
    fetchedAt,
    expiresAt,
    parserProvider: 'mock',
    xProvider: 'mock',
    modes: buildMockCombatRecordModes('Operator#5745488'),
    ...overrides,
  };
}

describe('SQLite repositories', () => {
  let db: DatabaseSync;
  let statsRepo: SqliteStatsRepository;
  let jobRepo: SqliteJobRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    statsRepo = new SqliteStatsRepository(db);
    jobRepo = new SqliteJobRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns fresh cache before TTL expiry and falls back to getLatest after expiry', () => {
    const sample = makeSampleStats({
      fetchedAt: '2026-11-19T12:00:00.000Z',
      expiresAt: '2026-11-19T12:30:00.000Z',
    });
    statsRepo.upsert(sample);

    const beforeExpiry = new Date('2026-11-19T12:15:00.000Z');
    const afterExpiry = new Date('2026-11-19T12:31:00.000Z');

    expect(statsRepo.getFresh('operator#5745488', beforeExpiry)?.activisionId).toBe(
      'Operator#5745488',
    );
    expect(statsRepo.getFresh('operator#5745488', afterExpiry)).toBeNull();
    expect(statsRepo.getLatest('operator#5745488')?.activisionId).toBe('Operator#5745488');
  });

  it('tracks job queue order, deduplication lookups, and interrupted recovery', () => {
    const j1 = jobRepo.create({
      id: 'job-1',
      normalizedId: 'alpha#1111',
      activisionId: 'Alpha#1111',
    });
    const j2 = jobRepo.create({
      id: 'job-2',
      normalizedId: 'bravo#2222',
      activisionId: 'Bravo#2222',
    });

    expect(jobRepo.findActiveByNormalizedId('alpha#1111')?.id).toBe(j1.id);
    expect(jobRepo.getQueuePosition(j1.id)).toBe(1);
    expect(jobRepo.getQueuePosition(j2.id)).toBe(2);
    expect(jobRepo.countPending()).toBe(2);

    jobRepo.markRunning(j1.id, 'posting_tweet');
    expect(jobRepo.recoverInterruptedJobs()).toBe(1);
    expect(jobRepo.findById(j1.id)?.state).toBe('queued');

    jobRepo.complete(j1.id, makeSampleStats({ activisionId: 'Alpha#1111', normalizedId: 'alpha#1111' }));
    expect(jobRepo.findActiveByNormalizedId('alpha#1111')).toBeNull();
    expect(jobRepo.getQueuePosition(j2.id)).toBe(1);

    // Backdate j1 beyond 24h retention and confirm next create prunes it
    db.prepare(`UPDATE lookup_jobs SET updated_at = ? WHERE id = ?`).run(
      new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      j1.id,
    );
    jobRepo.create({
      id: 'job-3',
      normalizedId: 'charlie#3333',
      activisionId: 'Charlie#3333',
    });
    expect(jobRepo.findById(j1.id)).toBeNull();
    expect(jobRepo.findById(j2.id)).not.toBeNull();
  });
});
