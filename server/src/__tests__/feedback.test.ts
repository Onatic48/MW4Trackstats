import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { createApp } from '../app.js';
import { loadConfig, type AppConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { SqliteFeedbackRepository } from '../db/feedbackRepository.js';
import { SqliteJobRepository, SqliteStatsRepository } from '../db/repository.js';
import { SqliteSessionRepository } from '../db/sessionRepository.js';
import {
  sanitizeSpreadsheetCell,
  validateGoogleAppsScriptUrl,
} from '../providers/feedback/googleSheetsWebhook.js';
import { MockImageParser } from '../providers/parser/mockParser.js';
import { MockXProvider } from '../providers/x/mockXProvider.js';
import { JobQueueService } from '../queue/jobQueue.js';

describe('X-authenticated feedback endpoint and Google Sheets webhook', () => {
  let db: DatabaseSync;
  let config: AppConfig;
  let sessionRepo: SqliteSessionRepository;
  let feedbackRepo: SqliteFeedbackRepository;
  let jobQueue: JobQueueService;
  let feedbackFetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    config = loadConfig({
      DATABASE_PATH: ':memory:',
      CLIENT_ORIGIN: 'https://mw4stats.duckdns.org,http://localhost:5173',
      X_PROVIDER: 'mock',
      PARSER_PROVIDER: 'mock',
      X_COOLDOWN_MS: '0',
      MOCK_STEP_DELAY_MS: '5',
      GOOGLE_SHEETS_WEBHOOK_URL: 'https://script.google.com/macros/s/demo-deployment/exec',
      GOOGLE_SHEETS_WEBHOOK_SECRET: 'super-secret-token',
    });

    db = openDatabase(':memory:');
    const statsRepo = new SqliteStatsRepository(db);
    const jobRepo = new SqliteJobRepository(db);
    sessionRepo = new SqliteSessionRepository(db);
    feedbackRepo = new SqliteFeedbackRepository(db);

    feedbackFetchMock = vi.fn<typeof fetch>();
    const xProvider = new MockXProvider({ botHandle: config.xBotHandle, stepDelayMs: 5 });
    const imageParser = new MockImageParser();

    jobQueue = new JobQueueService({
      statsRepo,
      jobRepo,
      sessionRepo,
      xProvider,
      imageParser,
      config,
    });
    jobQueue.start();

    app = createApp({
      config,
      statsRepo,
      jobRepo,
      sessionRepo,
      feedbackRepo,
      xProvider,
      activeParserProvider: imageParser.name,
      jobQueue,
      feedbackFetchImpl: feedbackFetchMock as unknown as typeof fetch,
    });
  });

  afterEach(async () => {
    await jobQueue.stop();
    db.close();
  });

  it('rejects unauthenticated POST /api/feedback with 401 USER_X_LOGIN_REQUIRED', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .send({ message: 'Great tracker for Season 01', locale: 'en' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('USER_X_LOGIN_REQUIRED');
    expect(feedbackFetchMock).not.toHaveBeenCalled();
  });

  it('blocks cross-origin POST /api/feedback requests with 403', async () => {
    const session = sessionRepo.createSession({
      xUserId: 'uid-cross',
      xUsername: 'cross_user',
      accessToken: 'tok-1',
      refreshToken: null,
      expiresInSeconds: 3600,
    });

    const res = await request(app)
      .post('/api/feedback')
      .set('Cookie', `mw4_session=${session.id}`)
      .set('Origin', 'https://evil.example')
      .send({ message: 'Cross origin feedback attempt', locale: 'en' });

    expect(res.status).toBe(403);
    expect(feedbackFetchMock).not.toHaveBeenCalled();
  });

  it('rejects messages shorter than 5 characters with 400', async () => {
    const session = sessionRepo.createSession({
      xUserId: 'uid-short',
      xUsername: 'short_user',
      accessToken: 'tok-2',
      refreshToken: null,
      expiresInSeconds: 3600,
    });

    const res = await request(app)
      .post('/api/feedback')
      .set('Cookie', `mw4_session=${session.id}`)
      .set('Origin', 'https://mw4stats.duckdns.org')
      .send({ message: 'hi', locale: 'en' });

    expect(res.status).toBe(400);
    expect(feedbackFetchMock).not.toHaveBeenCalled();
  });

  it('persists authenticated feedback, neutralizes spreadsheet formulas, and syncs to Google Sheets', async () => {
    const session = sessionRepo.createSession({
      xUserId: 'uid-hakan',
      xUsername: 'Onatic2',
      accessToken: 'tok-valid',
      refreshToken: null,
      expiresInSeconds: 3600,
    });

    feedbackFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
    );

    const res = await request(app)
      .post('/api/feedback')
      .set('Cookie', `mw4_session=${session.id}`)
      .set('Origin', 'https://mw4stats.duckdns.org')
      .send({ message: '=SUM(A1) great site for DMZ tracking', locale: 'tr' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.syncedToSheets).toBe(true);
    expect(typeof res.body.id).toBe('string');

    expect(feedbackFetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = feedbackFetchMock.mock.calls[0]!;
    expect(String(calledUrl)).toBe('https://script.google.com/macros/s/demo-deployment/exec');
    expect(init?.redirect).toBe('follow');

    const sentPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(sentPayload.secret).toBe('super-secret-token');
    expect(sentPayload.xUserId).toBe('uid-hakan');
    expect(sentPayload.xUsername).toBe("'@Onatic2");
    expect(sentPayload.message).toBe("'=SUM(A1) great site for DMZ tracking");
    expect(sentPayload.locale).toBe('tr');

    const stored = feedbackRepo.findById(res.body.id as string);
    expect(stored?.syncedToSheets).toBe(true);
    expect(stored?.syncError).toBeNull();
    expect(stored?.xUsername).toBe('Onatic2');
  });

  it('enforces feedback submission rate limit of 5 per window and returns 429 on 6th', async () => {
    const session = sessionRepo.createSession({
      xUserId: 'uid-spam',
      xUsername: 'spam_tester',
      accessToken: 'tok-spam',
      refreshToken: null,
      expiresInSeconds: 3600,
    });

    feedbackFetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    for (let i = 0; i < 5; i += 1) {
      const okRes = await request(app)
        .post('/api/feedback')
        .set('Cookie', `mw4_session=${session.id}`)
        .set('Origin', 'https://mw4stats.duckdns.org')
        .send({ message: `Valid feedback message #${i + 1}`, locale: 'en' });
      expect(okRes.status).toBe(201);
    }

    const limitedRes = await request(app)
      .post('/api/feedback')
      .set('Cookie', `mw4_session=${session.id}`)
      .set('Origin', 'https://mw4stats.duckdns.org')
      .send({ message: 'Sixth feedback attempt should fail', locale: 'en' });

    expect(limitedRes.status).toBe(429);
    expect(limitedRes.body.error.code).toBe('RATE_LIMITED');
    expect(feedbackFetchMock).toHaveBeenCalledTimes(5);
  });

  it('validates Google Apps Script webhook URLs and sanitizes dangerous formula prefixes', () => {
    expect(() =>
      validateGoogleAppsScriptUrl('http://script.google.com/macros/s/abc/exec'),
    ).toThrow(/HTTPS/i);
    expect(() => validateGoogleAppsScriptUrl('https://evil.example/hook')).toThrow(/untrusted/i);
    expect(
      validateGoogleAppsScriptUrl('https://script.google.com/macros/s/abc/exec').hostname,
    ).toBe('script.google.com');

    expect(sanitizeSpreadsheetCell('=CMD()')).toBe("'=CMD()");
    expect(sanitizeSpreadsheetCell('+123')).toBe("'+123");
    expect(sanitizeSpreadsheetCell('-123')).toBe("'-123");
    expect(sanitizeSpreadsheetCell('@user')).toBe("'@user");
    expect(sanitizeSpreadsheetCell('Normal comment')).toBe('Normal comment');
  });
});
