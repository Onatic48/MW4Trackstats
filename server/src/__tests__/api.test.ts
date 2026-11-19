import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { JobStatusResponse, StatsLookupResponse } from '@mw4trackstats/shared';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { SqliteJobRepository, SqliteStatsRepository } from '../db/repository.js';
import { MockImageParser } from '../providers/parser/mockParser.js';
import { MockXProvider } from '../providers/x/mockXProvider.js';
import { JobQueueService } from '../queue/jobQueue.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('MW4Trackstats HTTP API & Queue Integration', () => {
  let tmpDir: string;
  let db: DatabaseSync;
  let jobQueue: JobQueueService;
  let xProvider: MockXProvider;
  let requestSpy: ReturnType<typeof vi.spyOn>;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mw4-api-'));
    const config = loadConfig({
      DATABASE_PATH: ':memory:',
      IMAGES_DIR: path.join(tmpDir, 'images'),
      CACHE_TTL_MINUTES: '30',
      X_PROVIDER: 'mock',
      PARSER_PROVIDER: 'mock',
      X_COOLDOWN_MS: '0',
      MOCK_STEP_DELAY_MS: '15',
      GEMINI_MODEL: 'gemini-3.5-flash',
      RATE_LIMIT_MAX_UNCACHED: '3',
      RATE_LIMIT_MAX_READS: '100',
    });

    db = openDatabase(':memory:');
    const statsRepo = new SqliteStatsRepository(db);
    const jobRepo = new SqliteJobRepository(db);
    xProvider = new MockXProvider({
      botHandle: config.xBotHandle,
      stepDelayMs: 15,
    });
    requestSpy = vi.spyOn(xProvider, 'requestCombatRecord');
    const imageParser = new MockImageParser();

    jobQueue = new JobQueueService({
      statsRepo,
      jobRepo,
      xProvider,
      imageParser,
      config,
    });
    jobQueue.start();

    app = createApp({
      config,
      statsRepo,
      jobRepo,
      xProvider,
      activeParserProvider: imageParser.name,
      jobQueue,
    });
  });

  afterEach(async () => {
    await jobQueue.stop();
    db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('rejects invalid Activision ID with 400', async () => {
    const res = await request(app).post('/api/stats').send({ activisionId: 'invalid-id' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
  });

  it('queues uncached lookup, deduplicates concurrent requests, caches for 30m, and serves image safely', async () => {
    const [first, second] = await Promise.all([
      request(app).post('/api/stats').send({ activisionId: 'Operator#5745488' }),
      request(app).post('/api/stats').send({ activisionId: 'operator#5745488' }),
    ]);

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const firstBody = first.body as Extract<StatsLookupResponse, { status: 'queued' }>;
    const secondBody = second.body as Extract<StatsLookupResponse, { status: 'queued' }>;

    expect(secondBody.jobId).toBe(firstBody.jobId);
    expect(secondBody.deduplicated).toBe(true);

    let jobStatus: JobStatusResponse | null = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const poll = await request(app).get(`/api/stats/jobs/${firstBody.jobId}`);
      expect(poll.status).toBe(200);
      jobStatus = poll.body as JobStatusResponse;
      if (jobStatus.state === 'completed' || jobStatus.state === 'failed') {
        break;
      }
      await sleep(40);
    }

    expect(jobStatus?.state).toBe('completed');
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(jobStatus?.result?.modes.multiplayer.kills).toBe(149);
    expect(jobStatus?.result?.modes.dmz.timePlayedMinutes).toBe(6840);
    expect(jobStatus?.result?.modes.battleRoyale.kills).toBeNull();
    expect(jobStatus?.result?.modes.resurgence.kdRatio).toBe(0);

    // Subsequent lookup within 30 minutes hits cache immediately without hitting X again
    const cachedRes = await request(app)
      .post('/api/stats')
      .send({ activisionId: 'Operator#5745488' });
    expect(cachedRes.status).toBe(200);
    expect(cachedRes.body.status).toBe('cached');
    expect(requestSpy).toHaveBeenCalledTimes(1);

    // Recent players endpoint includes the cached record
    const recentRes = await request(app).get('/api/stats/recent');
    expect(recentRes.status).toBe(200);
    expect(recentRes.body.items).toHaveLength(1);
    expect(recentRes.body.items[0].activisionId).toBe('Operator#5745488');

    // Generated card image is served and path traversal is rejected
    const imagePath = jobStatus?.result?.localImagePath ?? '';
    expect(imagePath).toMatch(/^\/api\/images\/[a-f0-9-]+\.png$/);
    const imgRes = await request(app).get(imagePath);
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers['content-type']).toMatch(/image\/png/);
    expect(imgRes.headers['x-content-type-options']).toBe('nosniff');
    expect(imgRes.headers['x-frame-options']).toBe('DENY');

    // Force-refreshing the same player replaces the cached image and unlinks the old image file
    const refreshRes = await request(app)
      .post('/api/stats')
      .send({ activisionId: 'Operator#5745488', forceRefresh: true });
    expect(refreshRes.status).toBe(202);
    let refreshedImagePath = '';
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const poll = await request(app).get(`/api/stats/jobs/${refreshRes.body.jobId}`);
      if (poll.body.state === 'completed' || poll.body.state === 'failed') {
        refreshedImagePath = poll.body.result?.localImagePath ?? '';
        break;
      }
      await sleep(40);
    }
    const oldImgRes = await request(app).get(imagePath);
    expect(oldImgRes.status).toBe(404);

    // Self-service right-to-erasure endpoint (/api/stats/purge) deletes cached stats row and image
    const purgeRes = await request(app)
      .post('/api/stats/purge')
      .send({ activisionId: 'Operator#5745488' });
    expect(purgeRes.status).toBe(200);
    expect(purgeRes.body).toEqual({
      deleted: true,
      activisionId: 'Operator#5745488',
    });
    const purgedImgRes = await request(app).get(refreshedImagePath);
    expect(purgedImgRes.status).toBe(404);
    const purgedPlayerRes = await request(app).get('/api/stats/player/Operator%235745488');
    expect(purgedPlayerRes.status).toBe(404);

    const badImg = await request(app).get('/api/images/..%2F..%2Fpackage.json');
    expect(badImg.status).toBe(400);
  });

  it('streams SSE job completion updates and reports health metadata', async () => {
    const healthRes = await request(app).get('/api/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.geminiModel).toBe('gemini-3.5-flash');

    const postRes = await request(app)
      .post('/api/stats')
      .send({ activisionId: 'CaptainPrice#1412123' });
    expect(postRes.status).toBe(202);

    const sseRes = await request(app).get(`/api/stats/jobs/${postRes.body.jobId}/stream`);
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers['content-type']).toMatch(/text\/event-stream/);
    expect(sseRes.text).toContain('event: status');
    expect(sseRes.text).toContain('"state":"completed"');
  });

  it('enforces IP rate limiting on uncached lookups while still allowing cached lookups', async () => {
    const r1 = await request(app).post('/api/stats').send({ activisionId: 'Alpha#1001' });
    const r2 = await request(app).post('/api/stats').send({ activisionId: 'Bravo#1002' });
    const r3 = await request(app).post('/api/stats').send({ activisionId: 'Charlie#1003' });
    const r4 = await request(app).post('/api/stats').send({ activisionId: 'Delta#1004' });

    expect(r1.status).toBe(202);
    expect(r2.status).toBe(202);
    expect(r3.status).toBe(202);
    expect(r4.status).toBe(429);
    expect(r4.body.error.code).toBe('RATE_LIMITED');

    // Wait for r1 to finish caching, then verify cached lookup succeeds without hitting write limit
    for (let i = 0; i < 80; i += 1) {
      const poll = await request(app).get(`/api/stats/jobs/${r1.body.jobId}`);
      if (poll.body.state === 'completed') break;
      await sleep(40);
    }
    const cachedCheck = await request(app).post('/api/stats').send({ activisionId: 'Alpha#1001' });
    expect(cachedCheck.status).toBe(200);
    expect(cachedCheck.body.status).toBe('cached');
  });

  it('ignores spoofed X-Forwarded-For headers when trustProxy is disabled', async () => {
    const r1 = await request(app)
      .post('/api/stats')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ activisionId: 'SpoofOne#1001' });
    const r2 = await request(app)
      .post('/api/stats')
      .set('X-Forwarded-For', '203.0.113.20')
      .send({ activisionId: 'SpoofTwo#1002' });
    const r3 = await request(app)
      .post('/api/stats')
      .set('X-Forwarded-For', '203.0.113.30')
      .send({ activisionId: 'SpoofThree#1003' });
    const r4 = await request(app)
      .post('/api/stats')
      .set('X-Forwarded-For', '203.0.113.40')
      .send({ activisionId: 'SpoofFour#1004' });

    expect(r1.status).toBe(202);
    expect(r2.status).toBe(202);
    expect(r3.status).toBe(202);
    expect(r4.status).toBe(429);
    expect(r4.body.error.code).toBe('RATE_LIMITED');
  });
});
