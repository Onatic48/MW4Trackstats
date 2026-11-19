import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { JobStatusResponse } from '@mw4trackstats/shared';
import { createApp } from '../app.js';
import { loadConfig, type AppConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { SqliteJobRepository, SqliteStatsRepository } from '../db/repository.js';
import { SqliteSessionRepository } from '../db/sessionRepository.js';
import type { ImageParser } from '../providers/parser/index.js';
import { OfficialApiXProvider } from '../providers/x/officialApiXProvider.js';
import { generatePkcePair } from '../providers/x/xOAuth2.js';
import { JobQueueService } from '../queue/jobQueue.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('X OAuth 2.0 PKCE User Flow & Daily Limit Isolation', () => {
  let tmpDir: string;
  let db: DatabaseSync;
  let statsRepo: SqliteStatsRepository;
  let jobRepo: SqliteJobRepository;
  let sessionRepo: SqliteSessionRepository;
  let config: AppConfig;
  let jobQueue: JobQueueService;
  let apiFetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let authFetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mw4-oauth2-'));
    config = loadConfig({
      DATABASE_PATH: ':memory:',
      IMAGES_DIR: path.join(tmpDir, 'images'),
      CACHE_TTL_MINUTES: '30',
      X_PROVIDER: 'api',
      PARSER_PROVIDER: 'mock',
      X_COOLDOWN_MS: '0',
      X_REPLY_TIMEOUT_MS: '1000',
      X_POLL_INTERVAL_MS: '500',
      X_OAUTH2_CLIENT_ID: 'client-id-123',
      X_OAUTH2_CLIENT_SECRET: 'client-secret-456',
      X_OAUTH2_REDIRECT_URI: 'http://127.0.0.1:3001/callback',
      CLIENT_ORIGIN: 'http://localhost:5173',
      RATE_LIMIT_MAX_UNCACHED: '20',
    });

    db = openDatabase(':memory:');
    statsRepo = new SqliteStatsRepository(db);
    jobRepo = new SqliteJobRepository(db);
    sessionRepo = new SqliteSessionRepository(db);

    apiFetchMock = vi.fn<typeof fetch>();
    authFetchMock = vi.fn<typeof fetch>();

    const xProvider = new OfficialApiXProvider({
      bearerToken: '',
      apiKey: '',
      apiSecret: '',
      accessToken: '',
      accessSecret: '',
      botHandle: config.xBotHandle,
      pinnedTweetId: config.xPinnedTweetId,
      replyTimeoutMs: config.xReplyTimeoutMs,
      pollIntervalMs: 5,
      oauth2Configured: config.oauth2Configured,
      fetchImpl: apiFetchMock as unknown as typeof fetch,
    });

    const stubParser: ImageParser = {
      name: 'mock',
      parse: async ({ activisionId }) => ({
        parsedActivisionId: activisionId,
        season: 'Season 01',
        cardLayout: 'single_mode',
        modes: {
          multiplayer: {
            timePlayed: '1D 9H',
            timePlayedMinutes: 1980,
            kills: 8214,
            kdRatio: 1.43,
            highestStreak: 21,
            wins: 132,
            gamesPlayed: 342,
            winLossRatio: 0.66,
            accuracyPercent: 30,
          },
          dmz: {
            timePlayed: null,
            timePlayedMinutes: null,
            playerEliminations: null,
            hostileEliminations: null,
            containersOpened: null,
            successfulExfils: null,
          },
          battleRoyale: {
            timePlayed: null,
            timePlayedMinutes: null,
            kills: null,
            kdRatio: null,
            highestKillsPerGame: null,
            wins: null,
          },
          resurgence: {
            timePlayed: null,
            timePlayedMinutes: null,
            kills: null,
            kdRatio: null,
            highestKillsPerGame: null,
            wins: null,
          },
        },
      }),
    };

    jobQueue = new JobQueueService({
      statsRepo,
      jobRepo,
      sessionRepo,
      xProvider,
      imageParser: stubParser,
      config,
      fetchImpl: apiFetchMock as unknown as typeof fetch,
    });
    jobQueue.start();

    app = createApp({
      config,
      statsRepo,
      jobRepo,
      sessionRepo,
      xProvider,
      activeParserProvider: 'mock',
      jobQueue,
      authFetchImpl: authFetchMock as unknown as typeof fetch,
    });
  });

  afterEach(async () => {
    await jobQueue.stop();
    db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('generates valid S256 PKCE verifier and challenge pairs', () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    const expected = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    expect(codeChallenge).toBe(expected);
  });

  it('completes OAuth 2.0 login -> /callback -> /api/auth/x/complete cookie -> /api/auth/me -> logout', async () => {
    const loginRes = await request(app).get('/api/auth/x/login?returnId=iiode-%239775441');
    expect(loginRes.status).toBe(302);
    const loginCookies = loginRes.headers['set-cookie'];
    expect(loginCookies).toBeDefined();
    const oauthStateCookie = Array.isArray(loginCookies)
      ? loginCookies[0] ?? ''
      : String(loginCookies);
    expect(oauthStateCookie).toContain('mw4_oauth_state=');

    const authorizeUrl = new URL(loginRes.headers.location ?? '');
    expect(authorizeUrl.origin).toBe('https://x.com');
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
    const state = authorizeUrl.searchParams.get('state') ?? '';
    expect(state).toBeTruthy();

    authFetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'user-access-1',
            refresh_token: 'user-refresh-1',
            expires_in: 7200,
            scope: 'tweet.read tweet.write users.read offline.access',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { id: 'uid-alice', username: 'alice_cod' } }),
          { status: 200 },
        ),
      );

    const cbRes = await request(app).get(`/callback?code=auth-code-99&state=${encodeURIComponent(state)}`);
    expect(cbRes.status).toBe(302);
    const completeRedirect = new URL(cbRes.headers.location ?? '');
    expect(completeRedirect.pathname).toBe('/api/auth/x/complete');
    const ticket = completeRedirect.searchParams.get('ticket') ?? '';

    const completeRes = await request(app)
      .get(`/api/auth/x/complete?ticket=${encodeURIComponent(ticket)}`)
      .set('Cookie', oauthStateCookie);
    expect(completeRes.status).toBe(302);
    expect(completeRes.headers.location).toBe('/?id=iiode-%239775441&autolookup=1');

    const cookies = completeRes.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const cookieList = Array.isArray(cookies) ? cookies : [String(cookies)];
    const sessionCookie = cookieList.find((c) => c.startsWith('mw4_session=')) ?? '';
    expect(sessionCookie).toContain('mw4_session=');
    expect(sessionCookie).toContain('HttpOnly');

    const meRes = await request(app).get('/api/auth/me').set('Cookie', sessionCookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body).toEqual({
      authenticated: true,
      oauthConfigured: true,
      user: { xUserId: 'uid-alice', username: 'alice_cod' },
    });

    const logoutRes = await request(app).post('/api/auth/logout').set('Cookie', sessionCookie);
    expect(logoutRes.status).toBe(200);
    const meAfter = await request(app).get('/api/auth/me').set('Cookie', sessionCookie);
    expect(meAfter.body.authenticated).toBe(false);
  });

  it('requires user X login for uncached POST /api/stats while serving cached records publicly', async () => {
    const unauthRes = await request(app)
      .post('/api/stats')
      .send({ activisionId: 'iiode-#9775441' });
    expect(unauthRes.status).toBe(401);
    expect(unauthRes.body.error.code).toBe('USER_X_LOGIN_REQUIRED');

    statsRepo.upsert({
      activisionId: 'iiode-#9775441',
      normalizedId: 'iiode-#9775441',
      parsedActivisionId: 'iiode-#9775441',
      season: 'Season 01',
      sourceBotHandle: 'CODCombatRecord',
      replyTweetId: 'r-1',
      imageUrl: null,
      localImagePath: null,
      fetchedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      parserProvider: 'gemini',
      xProvider: 'api',
      cardLayout: 'single_mode',
      modes: {
        multiplayer: {
          timePlayed: '1D 9H',
          timePlayedMinutes: 1980,
          kills: 8214,
          kdRatio: 1.43,
          highestStreak: 21,
          wins: 132,
          gamesPlayed: 342,
          winLossRatio: 0.66,
          accuracyPercent: 30,
        },
        dmz: {
          timePlayed: null,
          timePlayedMinutes: null,
          playerEliminations: null,
          hostileEliminations: null,
          containersOpened: null,
          successfulExfils: null,
        },
        battleRoyale: {
          timePlayed: null,
          timePlayedMinutes: null,
          kills: null,
          kdRatio: null,
          highestKillsPerGame: null,
          wins: null,
        },
        resurgence: {
          timePlayed: null,
          timePlayedMinutes: null,
          kills: null,
          kdRatio: null,
          highestKillsPerGame: null,
          wins: null,
        },
      },
    });

    const publicCachedRes = await request(app)
      .post('/api/stats')
      .send({ activisionId: 'iiode-#9775441' });
    expect(publicCachedRes.status).toBe(200);
    expect(publicCachedRes.body.status).toBe('cached');
  });

  it('serves stale cached profile via GET /api/stats/player/:id without X login while requiring X login for live POST /api/stats', async () => {
    statsRepo.upsert({
      activisionId: 'Onatic#3733397',
      normalizedId: 'onatic#3733397',
      parsedActivisionId: 'Onatic#3733397',
      season: 'Season 01',
      sourceBotHandle: 'CODCombatRecord',
      replyTweetId: '2123465813113851941',
      imageUrl: 'https://pbs.twimg.com/media/HXgQ53eXAAAnXWK.jpg',
      localImagePath: null,
      fetchedAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-01T00:30:00.000Z',
      parserProvider: 'gemini',
      xProvider: 'api',
      cardLayout: 'multi_mode',
      modes: {
        multiplayer: {
          timePlayed: '14H 35M',
          timePlayedMinutes: 875,
          kills: 2401,
          kdRatio: 0.98,
          highestStreak: 12,
          wins: 67,
        },
        dmz: {
          timePlayed: '2D 4H',
          timePlayedMinutes: 3120,
          playerEliminations: 236,
          hostileEliminations: 6916,
          containersOpened: 4014,
          successfulExfils: 108,
        },
        battleRoyale: {
          timePlayed: null,
          timePlayedMinutes: null,
          kills: null,
          kdRatio: null,
          highestKillsPerGame: null,
          wins: null,
        },
        resurgence: {
          timePlayed: null,
          timePlayedMinutes: null,
          kills: null,
          kdRatio: null,
          highestKillsPerGame: null,
          wins: null,
        },
      },
    });

    const getRes = await request(app).get('/api/stats/player/Onatic%233733397');
    expect(getRes.status).toBe(200);
    expect(getRes.body.found).toBe(true);
    expect(getRes.body.fresh).toBe(false);
    expect(getRes.body.data.activisionId).toBe('Onatic#3733397');
    expect(getRes.body.data.imageUrl).toBe('https://pbs.twimg.com/media/HXgQ53eXAAAnXWK.jpg');

    const postRes = await request(app)
      .post('/api/stats')
      .send({ activisionId: 'Onatic#3733397' });
    expect(postRes.status).toBe(401);
    expect(postRes.body.error.code).toBe('USER_X_LOGIN_REQUIRED');
  });

  it('refreshes expired user OAuth 2.0 token automatically and fetches & caches stats', async () => {
    const expiredSession = sessionRepo.createSession({
      xUserId: 'uid-bob',
      xUsername: 'bob_cod',
      accessToken: 'stale-access',
      refreshToken: 'valid-refresh',
      expiresInSeconds: 60,
    });
    // Force expiry into the past so JobQueueService refreshes before calling X
    db.prepare('UPDATE x_sessions SET token_expires_at = ? WHERE id = ?').run(
      '2020-01-01T00:00:00.000Z',
      expiredSession.id,
    );

    apiFetchMock
      // 1) Refresh token call
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'fresh-access-bob',
            refresh_token: 'fresh-refresh-bob',
            expires_in: 7200,
          }),
          { status: 200 },
        ),
      )
      // 2) POST /2/tweets
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'tweet-bob-1' } }), { status: 201 }),
      )
      // 3) GET /2/users/uid-bob/mentions
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'bot-reply-bob-1',
                author_id: 'bot-1',
                referenced_tweets: [{ type: 'replied_to', id: 'tweet-bob-1' }],
                attachments: { media_keys: ['m-bob'] },
              },
            ],
            includes: {
              users: [{ id: 'bot-1', username: 'CODCombatRecord' }],
              media: [
                {
                  media_key: 'm-bob',
                  type: 'photo',
                  url: 'https://pbs.twimg.com/media/bobcard.png',
                },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      // 4) Download image from pbs.twimg.com
      .mockResolvedValueOnce(
        new Response(PNG_HEADER, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      );

    const postRes = await request(app)
      .post('/api/stats')
      .set('Cookie', `mw4_session=${expiredSession.id}`)
      .send({ activisionId: 'iiode-#9775441' });

    expect(postRes.status).toBe(202);
    const jobId = postRes.body.jobId as string;

    let finalJob: JobStatusResponse | null = null;
    for (let i = 0; i < 60; i += 1) {
      const poll = await request(app).get(`/api/stats/jobs/${jobId}`);
      finalJob = poll.body as JobStatusResponse;
      if (finalJob.state === 'completed' || finalJob.state === 'failed') {
        break;
      }
      await sleep(20);
    }

    expect(finalJob?.state).toBe('completed');
    expect(finalJob?.result?.cardLayout).toBe('single_mode');
    expect(finalJob?.result?.modes.multiplayer.accuracyPercent).toBe(30);
    expect(finalJob?.result?.imageUrl).toBe('https://pbs.twimg.com/media/bobcard.png');
    expect(finalJob?.result?.localImagePath).toBeNull();
    const imagesDir = path.join(tmpDir, 'images');
    expect(!existsSync(imagesDir) || (await fs.readdir(imagesDir)).length === 0).toBe(true);
    expect(sessionRepo.findSessionById(expiredSession.id)?.accessToken).toBe(
      'fresh-access-bob',
    );
    const tweetHeaders = apiFetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(tweetHeaders.Authorization).toBe('Bearer fresh-access-bob');
  });

  it('maps @CODCombatRecord daily limit reply to X_RATE_LIMITED and isolates pause to that user', async () => {
    const userA = sessionRepo.createSession({
      xUserId: 'uid-a',
      xUsername: 'user_a',
      accessToken: 'token-a',
      refreshToken: null,
      expiresInSeconds: 7200,
    });
    const userB = sessionRepo.createSession({
      xUserId: 'uid-b',
      xUsername: 'user_b',
      accessToken: 'token-b',
      refreshToken: null,
      expiresInSeconds: 7200,
    });

    apiFetchMock
      // User A posts tweet -> bot responds with daily 5-request limit text
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'tweet-a1' } }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'bot-a1',
                author_id: 'bot-1',
                text: '@user_a You have reached the maximum amount of requests today!',
                referenced_tweets: [{ type: 'replied_to', id: 'tweet-a1' }],
              },
            ],
            includes: { users: [{ id: 'bot-1', username: 'CODCombatRecord' }] },
          }),
          { status: 200 },
        ),
      )
      // User B posts tweet -> succeeds independently!
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'tweet-b1' } }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'bot-b1',
                author_id: 'bot-1',
                referenced_tweets: [{ type: 'replied_to', id: 'tweet-b1' }],
                attachments: { media_keys: ['mb1'] },
              },
            ],
            includes: {
              users: [{ id: 'bot-1', username: 'CODCombatRecord' }],
              media: [
                {
                  media_key: 'mb1',
                  type: 'photo',
                  url: 'https://pbs.twimg.com/media/bcard.png',
                },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(PNG_HEADER, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      );

    const resA = await request(app)
      .post('/api/stats')
      .set('Cookie', `mw4_session=${userA.id}`)
      .send({ activisionId: 'PlayerA#1111' });
    expect(resA.status).toBe(202);

    let jobA: JobStatusResponse | null = null;
    for (let i = 0; i < 60; i += 1) {
      const poll = await request(app).get(`/api/stats/jobs/${resA.body.jobId}`);
      jobA = poll.body as JobStatusResponse;
      if (jobA.state === 'completed' || jobA.state === 'failed') break;
      await sleep(20);
    }
    expect(jobA?.state).toBe('failed');
    expect(jobA?.error?.code).toBe('X_RATE_LIMITED');

    // User B is unaffected by User A hitting the 5-request limit
    const resB = await request(app)
      .post('/api/stats')
      .set('Cookie', `mw4_session=${userB.id}`)
      .send({ activisionId: 'PlayerB#2222' });
    expect(resB.status).toBe(202);

    let jobB: JobStatusResponse | null = null;
    for (let i = 0; i < 60; i += 1) {
      const poll = await request(app).get(`/api/stats/jobs/${resB.body.jobId}`);
      jobB = poll.body as JobStatusResponse;
      if (jobB.state === 'completed' || jobB.state === 'failed') break;
      await sleep(20);
    }
    expect(jobB?.state).toBe('completed');
  });

  it('blocks Login CSRF on /api/auth/x/complete when browser lacks matching mw4_oauth_state cookie', async () => {
    const loginRes = await request(app).get('/api/auth/x/login');
    const authorizeUrl = new URL(loginRes.headers.location ?? '');
    const state = authorizeUrl.searchParams.get('state') ?? '';

    authFetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'attacker-access',
            refresh_token: 'attacker-refresh',
            expires_in: 7200,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { id: 'uid-attacker', username: 'attacker_x' } }),
          { status: 200 },
        ),
      );

    const cbRes = await request(app).get(
      `/callback?code=attacker-code&state=${encodeURIComponent(state)}`,
    );
    const completeRedirect = new URL(cbRes.headers.location ?? '');
    const ticket = completeRedirect.searchParams.get('ticket') ?? '';

    // Victim browser visits the complete URL without the attacker's mw4_oauth_state cookie
    const victimCompleteRes = await request(app).get(
      `/api/auth/x/complete?ticket=${encodeURIComponent(ticket)}`,
    );
    expect(victimCompleteRes.status).toBe(302);
    expect(victimCompleteRes.headers.location).toBe('/?authError=invalid_state');

    const cookies = victimCompleteRes.headers['set-cookie'];
    const cookieList = Array.isArray(cookies) ? cookies : cookies ? [String(cookies)] : [];
    expect(cookieList.some((c) => c.startsWith('mw4_session='))).toBe(false);

    // Ensure the created session was deleted when the CSRF attempt was rejected
    const remainingSessions = db
      .prepare('SELECT COUNT(*) AS count FROM x_sessions')
      .get() as { count: number };
    expect(remainingSessions.count).toBe(0);
  });

  it('blocks cross-origin and form-encoded POST CSRF on /api/auth/logout and /api/stats', async () => {
    const session = sessionRepo.createSession({
      xUserId: 'uid-csrf',
      xUsername: 'csrf_victim',
      accessToken: 'token-csrf',
      refreshToken: 'refresh-csrf',
      expiresInSeconds: 7200,
    });

    // 1) Cross-origin Origin header on logout
    const crossOriginLogout = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `mw4_session=${session.id}`)
      .set('Origin', 'https://evil.example');
    expect(crossOriginLogout.status).toBe(403);
    expect(sessionRepo.findSessionById(session.id)).not.toBeNull();

    // 2) HTML form Content-Type on logout
    const formLogout = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `mw4_session=${session.id}`)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('a=1');
    expect(formLogout.status).toBe(403);
    expect(sessionRepo.findSessionById(session.id)).not.toBeNull();

    // 3) Cross-origin Origin header on /api/stats
    const crossOriginStats = await request(app)
      .post('/api/stats')
      .set('Cookie', `mw4_session=${session.id}`)
      .set('Origin', 'https://evil.example')
      .send({ activisionId: 'iiode-#9775441' });
    expect(crossOriginStats.status).toBe(403);

    // 4) Legitimate same-origin JSON logout succeeds
    const validLogout = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `mw4_session=${session.id}`)
      .set('Origin', 'http://localhost:5173')
      .set('Content-Type', 'application/json')
      .send({});
    expect(validLogout.status).toBe(200);
    expect(sessionRepo.findSessionById(session.id)).toBeNull();
  });

  it('prunes expired non-refreshable x_sessions and reports unauthenticated on /api/auth/me', async () => {
    const noRefreshSession = sessionRepo.createSession({
      xUserId: 'uid-temp',
      xUsername: 'temp_user',
      accessToken: 'temp-token',
      refreshToken: null,
      expiresInSeconds: 60,
    });
    db.prepare('UPDATE x_sessions SET token_expires_at = ? WHERE id = ?').run(
      '2020-01-01T00:00:00.000Z',
      noRefreshSession.id,
    );

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `mw4_session=${noRefreshSession.id}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.authenticated).toBe(false);

    const row = db
      .prepare('SELECT id FROM x_sessions WHERE id = ?')
      .get(noRefreshSession.id);
    expect(row).toBeUndefined();
  });

  it('executes concurrent lookups across distinct X user sessions without head-of-line blocking', async () => {
    const userSlow = sessionRepo.createSession({
      xUserId: 'uid-slow',
      xUsername: 'slow_user',
      accessToken: 'token-slow',
      refreshToken: null,
      expiresInSeconds: 7200,
    });
    const userFast = sessionRepo.createSession({
      xUserId: 'uid-fast',
      xUsername: 'fast_user',
      accessToken: 'token-fast',
      refreshToken: null,
      expiresInSeconds: 7200,
    });

    apiFetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';

      if (url === 'https://api.x.com/2/tweets') {
        const isSlow = auth.includes('token-slow');
        return new Response(
          JSON.stringify({ data: { id: isSlow ? 'tweet-slow' : 'tweet-fast' } }),
          { status: 201 },
        );
      }

      if (url.includes('/2/users/uid-slow/mentions') || url.includes('to%3Aslow_user')) {
        await sleep(250);
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'reply-slow',
                author_id: 'bot-1',
                referenced_tweets: [{ type: 'replied_to', id: 'tweet-slow' }],
                attachments: { media_keys: ['m-slow'] },
              },
            ],
            includes: {
              users: [{ id: 'bot-1', username: 'CODCombatRecord' }],
              media: [{ media_key: 'm-slow', type: 'photo', url: 'https://pbs.twimg.com/media/slow.png' }],
            },
          }),
          { status: 200 },
        );
      }

      if (url.includes('/2/users/uid-fast/mentions') || url.includes('to%3Afast_user')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'reply-fast',
                author_id: 'bot-1',
                referenced_tweets: [{ type: 'replied_to', id: 'tweet-fast' }],
                attachments: { media_keys: ['m-fast'] },
              },
            ],
            includes: {
              users: [{ id: 'bot-1', username: 'CODCombatRecord' }],
              media: [{ media_key: 'm-fast', type: 'photo', url: 'https://pbs.twimg.com/media/fast.png' }],
            },
          }),
          { status: 200 },
        );
      }

      return new Response(PNG_HEADER, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    });

    const [resSlow, resFast] = await Promise.all([
      request(app)
        .post('/api/stats')
        .set('Cookie', `mw4_session=${userSlow.id}`)
        .send({ activisionId: 'SlowPlayer#1111' }),
      request(app)
        .post('/api/stats')
        .set('Cookie', `mw4_session=${userFast.id}`)
        .send({ activisionId: 'FastPlayer#2222' }),
    ]);

    expect(resSlow.status).toBe(202);
    expect(resFast.status).toBe(202);

    let fastDoneAt = 0;
    let slowDoneAt = 0;
    for (let i = 0; i < 80; i += 1) {
      const [pSlow, pFast] = await Promise.all([
        request(app).get(`/api/stats/jobs/${resSlow.body.jobId}`),
        request(app).get(`/api/stats/jobs/${resFast.body.jobId}`),
      ]);
      if (!fastDoneAt && pFast.body.state === 'completed') {
        fastDoneAt = Date.now();
      }
      if (!slowDoneAt && pSlow.body.state === 'completed') {
        slowDoneAt = Date.now();
      }
      if (fastDoneAt && slowDoneAt) {
        break;
      }
      await sleep(15);
    }

    expect(fastDoneAt).toBeGreaterThan(0);
    expect(slowDoneAt).toBeGreaterThan(0);
    expect(fastDoneAt).toBeLessThan(slowDoneAt);
  });
});
