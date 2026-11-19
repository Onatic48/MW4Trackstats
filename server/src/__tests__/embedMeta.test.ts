import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { CombatRecordStats } from '@mw4trackstats/shared';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { SqliteJobRepository, SqliteStatsRepository } from '../db/repository.js';
import { renderIndexHtmlWithEmbedMeta } from '../embeds/ogMeta.js';
import { MockImageParser } from '../providers/parser/mockParser.js';
import { MockXProvider } from '../providers/x/mockXProvider.js';
import { JobQueueService } from '../queue/jobQueue.js';

function makeOnaticStats(overrides: Partial<CombatRecordStats> = {}): CombatRecordStats {
  return {
    activisionId: 'Onatic#3733397',
    normalizedId: 'onatic#3733397',
    parsedActivisionId: 'Onatic#3733397',
    season: 'Season 01',
    sourceBotHandle: 'CODCombatRecord',
    replyTweetId: '2123465813113851941',
    imageUrl: 'https://pbs.twimg.com/media/HXgQ53eXAAAnXWK.jpg',
    localImagePath: null,
    fetchedAt: '2026-11-19T17:18:08.743Z',
    expiresAt: '2026-11-19T17:48:08.743Z',
    parserProvider: 'gemini',
    xProvider: 'api',
    cardLayout: 'multi_mode',
    modes: {
      multiplayer: {
        timePlayed: '14H 51M',
        timePlayedMinutes: 891,
        kills: 2463,
        kdRatio: 0.98,
        highestStreak: 12,
        wins: 68,
        gamesPlayed: 138,
        winLossRatio: 1.13,
        accuracyPercent: 24.57,
      },
      dmz: {
        timePlayed: '2D 4H',
        timePlayedMinutes: 3120,
        playerEliminations: 236,
        hostileEliminations: 6916,
        containersOpened: 4014,
        successfulExfils: 108,
        dynamicOps: 0,
        gamesPlayed: 151,
        medicalItems: 379,
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
    ...overrides,
  };
}

const SAMPLE_HTML_TEMPLATE = [
  '<!doctype html>',
  '<html lang="en">',
  '  <head>',
  '    <meta charset="UTF-8" />',
  '    <title>MW4Trackstats — Call of Duty Combat Record</title>',
  '  </head>',
  '  <body><div id="root"></div></body>',
  '</html>',
].join('\n');

describe('Dynamic Discord / Open Graph & oEmbed metadata', () => {
  let tmpRoot: string;
  let db: DatabaseSync;
  let statsRepo: SqliteStatsRepository;
  let jobQueue: JobQueueService;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mw4-og-'));
    await fs.mkdir(path.join(tmpRoot, 'client', 'dist'), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, 'client', 'dist', 'index.html'),
      SAMPLE_HTML_TEMPLATE,
      'utf8',
    );

    const config = loadConfig(
      {
        DATABASE_PATH: ':memory:',
        IMAGES_DIR: path.join(tmpRoot, 'images'),
        CLIENT_ORIGIN: 'https://mw4stats.duckdns.org,http://localhost:5173',
        SERVE_CLIENT_DIST: 'true',
        X_PROVIDER: 'mock',
        PARSER_PROVIDER: 'mock',
        X_COOLDOWN_MS: '0',
        MOCK_STEP_DELAY_MS: '5',
      },
      tmpRoot,
    );

    db = openDatabase(':memory:');
    statsRepo = new SqliteStatsRepository(db);
    const jobRepo = new SqliteJobRepository(db);
    const xProvider = new MockXProvider({ botHandle: config.xBotHandle, stepDelayMs: 5 });
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
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('renders rich Open Graph and Twitter summary_large_image tags for a cached 2-mode player', () => {
    const html = renderIndexHtmlWithEmbedMeta({
      templateHtml: SAMPLE_HTML_TEMPLATE,
      stats: makeOnaticStats(),
      queriedId: 'Onatic#3733397',
      publicOrigin: 'https://mw4stats.duckdns.org',
    });

    expect(html).toContain('<meta name="theme-color" content="#EAB308" />');
    expect(html).toContain('<meta property="og:site_name" content="MW4Trackstats" />');
    expect(html).toContain(
      '<meta property="og:title" content="Onatic#3733397 — Season 01 Combat Record" />',
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://mw4stats.duckdns.org/?id=Onatic%233733397" />',
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://pbs.twimg.com/media/HXgQ53eXAAAnXWK.jpg" />',
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain(
      '<meta name="twitter:image" content="https://pbs.twimg.com/media/HXgQ53eXAAAnXWK.jpg" />',
    );
    expect(html).toContain('MW4 Multiplayer: 14H 51M · 2,463 Kills · 0.98 K/D · 68 Wins · 24.57% Acc');
    expect(html).toContain('DMZ: 2D 4H · 236 Player Elims · 6,916 Hostile Elims · 108 Exfils');
    expect(html).not.toContain('Battle Royale:');
    expect(html).not.toContain('Resurgence:');
    expect(html).toContain(
      '<link rel="alternate" type="application/json+oembed" href="https://mw4stats.duckdns.org/api/oembed?id=Onatic%233733397"',
    );
  });

  it('escapes HTML attribute characters and strips untrusted embed image URLs', () => {
    const html = renderIndexHtmlWithEmbedMeta({
      templateHtml: SAMPLE_HTML_TEMPLATE,
      stats: makeOnaticStats({
        activisionId: 'Bad"Guy<tag>#1234',
        imageUrl: 'https://evil.example/payload.jpg',
        localImagePath: null,
      }),
      queriedId: null,
      publicOrigin: 'https://mw4stats.duckdns.org',
    });

    expect(html).toContain('Bad&quot;Guy&lt;tag&gt;#1234');
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('property="og:image"');
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
  });

  it('serves dynamic embed HTML on /?id=..., default OG HTML on /, and oEmbed JSON on /api/oembed', async () => {
    statsRepo.upsert(makeOnaticStats());

    const playerPageRes = await request(app).get('/?id=Onatic%233733397');
    expect(playerPageRes.status).toBe(200);
    expect(playerPageRes.headers['content-type']).toMatch(/text\/html/);
    expect(playerPageRes.text).toContain('https://pbs.twimg.com/media/HXgQ53eXAAAnXWK.jpg');
    expect(playerPageRes.text).toContain('Onatic#3733397 — Season 01 Combat Record');
    expect(playerPageRes.text).toContain('2,463 Kills');

    const homePageRes = await request(app).get('/');
    expect(homePageRes.status).toBe(200);
    expect(homePageRes.headers['content-type']).toMatch(/text\/html/);
    expect(homePageRes.text).toContain(
      '<meta property="og:title" content="MW4Trackstats — Call of Duty Combat Record" />',
    );
    expect(homePageRes.text).not.toContain('pbs.twimg.com');

    const oembedRes = await request(app).get('/api/oembed?id=Onatic%233733397');
    expect(oembedRes.status).toBe(200);
    expect(oembedRes.body).toEqual({
      version: '1.0',
      type: 'link',
      provider_name: 'MW4Trackstats',
      provider_url: 'https://mw4stats.duckdns.org',
      author_name: 'Season 01 · @CODCombatRecord',
      author_url: 'https://x.com/CODCombatRecord/status/2123465813113851941',
      title: 'Onatic#3733397 — Season 01 Combat Record',
    });
  });
});
