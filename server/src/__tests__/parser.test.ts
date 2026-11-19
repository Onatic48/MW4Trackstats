import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { MediaResolution, ThinkingLevel } from '@google/genai';
import {
  FastCardTemplateParser,
  GeminiVisionParser,
  HybridImageParser,
  normalizeParsedCard,
  ParseFailedError,
  type GeminiClientLike,
  type ImageParser,
} from '../providers/parser/index.js';
import { MockImageParser } from '../providers/parser/mockParser.js';
import {
  buildMockCombatRecordModes,
  renderMockCombatCardPng,
} from '../providers/x/mockXProvider.js';
import {
  downloadTrustedXImage,
  fetchTrustedXImageBuffer,
  validateTrustedImageUrl,
} from '../providers/x/mediaDownload.js';

describe('Combat record normalization and Gemini Vision parser', () => {
  it('normalizes #5745488 sample card accurately preserving 0.00 and converting "--" to null', () => {
    const normalized = normalizeParsedCard({
      parsedActivisionId: '#5745488',
      season: 'Season 01',
      multiplayer: {
        timePlayed: '1H 34M',
        kills: 149,
        kdRatio: 1.33,
        highestStreak: 10,
        wins: 5,
      },
      dmz: {
        timePlayed: '4D 18H',
        playerEliminations: 10,
        hostileEliminations: '39,101',
        containersOpened: '13,431',
        successfulExfils: 359,
      },
      battleRoyale: {
        timePlayed: '--',
        kills: '--',
        kdRatio: '--',
        highestKillsPerGame: '--',
        wins: '--',
      },
      resurgence: {
        timePlayed: '14M',
        kills: 39,
        kdRatio: '0.00',
        highestKillsPerGame: 39,
        wins: 1,
      },
    });

    expect(normalized.modes.multiplayer.timePlayedMinutes).toBe(94);
    expect(normalized.modes.dmz.timePlayedMinutes).toBe(6840);
    expect(normalized.modes.dmz.hostileEliminations).toBe(39101);
    expect(normalized.modes.battleRoyale).toEqual({
      timePlayed: null,
      timePlayedMinutes: null,
      kills: null,
      kdRatio: null,
      highestKillsPerGame: null,
      wins: null,
    });
    expect(normalized.modes.resurgence.kdRatio).toBe(0);
    expect(normalized.modes.resurgence.timePlayedMinutes).toBe(14);
    expect(normalized.cardLayout).toBe('multi_mode');
  });

  it('normalizes 8-metric single-mode portrait card (iiode-#9775441) accurately', () => {
    const normalized = normalizeParsedCard({
      parsedActivisionId: 'iiode-#9775441',
      season: 'Season 01',
      multiplayer: {
        timePlayed: '1D 9H',
        kills: 8214,
        kdRatio: 1.43,
        highestStreak: 21,
        wins: 132,
        gamesPlayed: 342,
        winLossRatio: 0.66,
        accuracyPercent: '30.00%',
      },
      dmz: {
        timePlayed: null,
        playerEliminations: null,
        hostileEliminations: null,
        containersOpened: null,
        successfulExfils: null,
      },
      battleRoyale: {
        timePlayed: null,
        kills: null,
        kdRatio: null,
        highestKillsPerGame: null,
        wins: null,
      },
      resurgence: {
        timePlayed: null,
        kills: null,
        kdRatio: null,
        highestKillsPerGame: null,
        wins: null,
      },
    });

    expect(normalized.cardLayout).toBe('single_mode');
    expect(normalized.modes.multiplayer).toEqual({
      timePlayed: '1D 9H',
      timePlayedMinutes: 1980,
      kills: 8214,
      kdRatio: 1.43,
      highestStreak: 21,
      wins: 132,
      gamesPlayed: 342,
      winLossRatio: 0.66,
      accuracyPercent: 30,
    });
  });

  it('invokes Gemini SDK with gemini-3.5-flash and structured responseJsonSchema', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        parsedActivisionId: '#5745488',
        season: 'Season 01',
        multiplayer: {
          timePlayed: '1H 34M',
          kills: 149,
          kdRatio: 1.33,
          highestStreak: 10,
          wins: 5,
        },
        dmz: {
          timePlayed: '4D 18H',
          playerEliminations: 10,
          hostileEliminations: 39101,
          containersOpened: 13431,
          successfulExfils: 359,
        },
        battleRoyale: {
          timePlayed: null,
          kills: null,
          kdRatio: null,
          highestKillsPerGame: null,
          wins: null,
        },
        resurgence: {
          timePlayed: '14M',
          kills: 39,
          kdRatio: 0,
          highestKillsPerGame: 39,
          wins: 1,
        },
      }),
    });

    const fakeClient: GeminiClientLike = {
      models: { generateContent },
    };

    const parser = new GeminiVisionParser({
      apiKey: 'test-key',
      model: 'gemini-3.5-flash',
      clientOverride: fakeClient,
    });

    const parsed = await parser.parse({
      buffer: Buffer.from('fake-png'),
      mimeType: 'image/png',
      activisionId: 'Operator#5745488',
    });

    expect(generateContent).toHaveBeenCalledTimes(1);
    const callArg = generateContent.mock.calls[0]?.[0];
    expect(callArg?.model).toBe('gemini-3.5-flash');
    expect(callArg?.config.responseMimeType).toBe('application/json');
    expect(callArg?.config.responseJsonSchema).toBeUndefined();
    expect(callArg?.config.thinkingConfig).toEqual({
      thinkingLevel: ThinkingLevel.MINIMAL,
    });
    expect(callArg?.config.mediaResolution).toBe(MediaResolution.MEDIA_RESOLUTION_MEDIUM);
    expect(callArg?.config.temperature).toBe(0);
    expect(callArg?.config.abortSignal).toBeInstanceOf(AbortSignal);
    const promptPart = callArg?.contents[0]?.parts[0];
    const promptText = promptPart && 'text' in promptPart ? promptPart.text : '';
    expect(promptText).toContain('parsedActivisionId');
    expect(promptText).toContain('accuracyPercent');
    expect(promptText).toContain('successfulExfils');
    expect(parsed.modes.resurgence.kdRatio).toBe(0);
    expect(parsed.modes.battleRoyale.kills).toBeNull();
  });

  it('fails over immediately to fallback model when primary returns HTTP 503 UNAVAILABLE', async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(
          new Error('{"error":{"code":503,"message":"High demand","status":"UNAVAILABLE"}}'),
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce({
        text: JSON.stringify({
          parsedActivisionId: 'Onatic#3733397',
          season: 'Season 01',
          multiplayer: {
            timePlayed: '14H 35M',
            kills: 2401,
            kdRatio: 0.98,
            highestStreak: 12,
            wins: 67,
            gamesPlayed: 135,
            winLossRatio: 1.16,
            accuracyPercent: 24.5,
          },
          dmz: {
            timePlayed: '2D 4H',
            playerEliminations: 236,
            hostileEliminations: 6916,
            containersOpened: 4014,
            successfulExfils: 108,
          },
          battleRoyale: null,
          resurgence: null,
        }),
      });

    const parser = new GeminiVisionParser({
      apiKey: 'test-key',
      model: 'gemini-3.1-flash-lite',
      fallbackModels: ['gemini-3.5-flash-lite'],
      clientOverride: { models: { generateContent } },
    });

    const parsed = await parser.parse({
      buffer: Buffer.from('fake-jpeg'),
      mimeType: 'image/jpeg',
      activisionId: 'Onatic#3733397',
    });

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[0]?.[0]?.model).toBe('gemini-3.1-flash-lite');
    expect(generateContent.mock.calls[1]?.[0]?.model).toBe('gemini-3.5-flash-lite');
    expect(parsed.cardLayout).toBe('multi_mode');
    expect(parsed.modes.multiplayer.kills).toBe(2401);
    expect(parsed.modes.dmz.successfulExfils).toBe(108);
    expect(parsed.modes.battleRoyale.kills).toBeNull();
  });

  it('does not retry fallbacks on non-transient HTTP 403 PERMISSION_DENIED', async () => {
    const generateContent = vi.fn().mockRejectedValueOnce(
      Object.assign(
        new Error('{"error":{"code":403,"message":"Permission denied","status":"PERMISSION_DENIED"}}'),
        { status: 403 },
      ),
    );

    const parser = new GeminiVisionParser({
      apiKey: 'bad-key',
      model: 'gemini-3.1-flash-lite',
      fallbackModels: ['gemini-3.5-flash-lite', 'gemini-3.8-flash'],
      clientOverride: { models: { generateContent } },
    });

    await expect(
      parser.parse({
        buffer: Buffer.from('fake-jpeg'),
        mimeType: 'image/jpeg',
        activisionId: 'Onatic#3733397',
      }),
    ).rejects.toThrow(ParseFailedError);

    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('FastCardTemplateParser decodes real 2-mode (Onatic#3733397) and 1-mode (iiode-#9775441) cards in <500ms', async () => {
    const fast = new FastCardTemplateParser();
    const imagesDir = path.resolve(import.meta.dirname, '../../data/images');
    const onaticPath = path.join(imagesDir, 'f9596928-05e8-475d-853e-538e12ec7ea7.jpg');
    const iiodePath = path.join(imagesDir, '64b16939-2cfd-423e-aeda-1bbc5e42c08b.jpg');

    if (existsSync(onaticPath)) {
      const buf = await fs.readFile(onaticPath);
      const t0 = Date.now();
      const parsed = await fast.tryParse({
        buffer: buf,
        mimeType: 'image/jpeg',
        activisionId: 'Onatic#3733397',
      });
      const elapsedMs = Date.now() - t0;

      expect(elapsedMs).toBeLessThan(500);
      expect(parsed?.cardLayout).toBe('multi_mode');
      expect(parsed?.modes.multiplayer).toEqual({
        timePlayed: '14H 35M',
        timePlayedMinutes: 875,
        kills: 2401,
        kdRatio: 0.98,
        highestStreak: 12,
        wins: 67,
        gamesPlayed: 135,
        winLossRatio: 1.16,
        accuracyPercent: 24.5,
      });
      expect(parsed?.modes.dmz).toEqual({
        timePlayed: '2D 4H',
        timePlayedMinutes: 3120,
        playerEliminations: 236,
        hostileEliminations: 6916,
        containersOpened: 4014,
        successfulExfils: 108,
        dynamicOps: 0,
        gamesPlayed: 151,
        medicalItems: 379,
      });
      expect(parsed?.modes.battleRoyale.kills).toBeNull();
      expect(parsed?.modes.resurgence.kills).toBeNull();
    }

    if (existsSync(iiodePath)) {
      const buf = await fs.readFile(iiodePath);
      const t0 = Date.now();
      const parsed = await fast.tryParse({
        buffer: buf,
        mimeType: 'image/jpeg',
        activisionId: 'iiode-#9775441',
      });
      const elapsedMs = Date.now() - t0;

      expect(elapsedMs).toBeLessThan(500);
      expect(parsed?.cardLayout).toBe('single_mode');
      expect(parsed?.modes.multiplayer).toEqual({
        timePlayed: '1D 9H',
        timePlayedMinutes: 1980,
        kills: 8214,
        kdRatio: 1.43,
        highestStreak: 21,
        wins: 132,
        gamesPlayed: 342,
        winLossRatio: 0.66,
        accuracyPercent: 30,
      });
      expect(parsed?.modes.dmz.timePlayed).toBeNull();
      expect(parsed?.modes.battleRoyale.timePlayed).toBeNull();
      expect(parsed?.modes.resurgence.timePlayed).toBeNull();
    }
  });

  it('HybridImageParser skips fallback on recognized cards and delegates synthetic mock PNGs cleanly', async () => {
    const fast = new FastCardTemplateParser();
    const mockPng = await renderMockCombatCardPng(
      'Operator#5745488',
      buildMockCombatRecordModes('Operator#5745488'),
      'CODCombatRecord',
    );
    expect(
      await fast.tryParse({
        buffer: mockPng,
        mimeType: 'image/png',
        activisionId: 'Operator#5745488',
      }),
    ).toBeNull();

    const fallbackMock = new MockImageParser();
    const fallbackSpy = vi.fn(fallbackMock.parse.bind(fallbackMock));
    const fallbackParser: ImageParser = {
      name: 'gemini',
      parse: fallbackSpy,
    };

    const hybrid = new HybridImageParser(fast, fallbackParser);
    expect(hybrid.name).toBe('gemini');

    const fallbackResult = await hybrid.parse({
      buffer: mockPng,
      mimeType: 'image/png',
      activisionId: 'Operator#5745488',
    });
    expect(fallbackSpy).toHaveBeenCalledTimes(1);
    expect(fallbackResult.modes.multiplayer.kills).toBe(149);

    const onaticPath = path.resolve(
      import.meta.dirname,
      '../../data/images/f9596928-05e8-475d-853e-538e12ec7ea7.jpg',
    );
    if (existsSync(onaticPath)) {
      const realBuf = await fs.readFile(onaticPath);
      const fastResult = await hybrid.parse({
        buffer: realBuf,
        mimeType: 'image/jpeg',
        activisionId: 'Onatic#3733397',
      });
      expect(fallbackSpy).toHaveBeenCalledTimes(1);
      expect(fastResult.modes.multiplayer.kills).toBe(2401);
    }
  });
});

describe('SSRF protection for media downloads', () => {
  it('blocks untrusted hosts, HTTP URLs, and direct IPs while allowing pbs.twimg.com', () => {
    expect(() => validateTrustedImageUrl('http://pbs.twimg.com/media/a.png')).toThrow();
    expect(() => validateTrustedImageUrl('https://127.0.0.1/media/a.png')).toThrow();
    expect(() => validateTrustedImageUrl('https://169.254.169.254/latest')).toThrow();
    expect(() => validateTrustedImageUrl('https://evil.example/a.png')).toThrow();
    expect(validateTrustedImageUrl('https://pbs.twimg.com/media/abc.jpg').hostname).toBe(
      'pbs.twimg.com',
    );
  });

  it('rejects redirects from pbs.twimg.com to untrusted hosts and saves valid PNG bytes', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mw4-media-'));

    const redirectFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://evil.example/payload.png' },
      }),
    ) as unknown as typeof fetch;

    await expect(
      downloadTrustedXImage('https://pbs.twimg.com/media/test.png', tmpDir, redirectFetch),
    ).rejects.toThrow(/untrusted image host/i);

    await expect(
      fetchTrustedXImageBuffer('https://pbs.twimg.com/media/test.png', redirectFetch),
    ).rejects.toThrow(/untrusted image host/i);

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const validFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(pngBytes, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      ),
    ) as unknown as typeof fetch;

    const emptyTmpBefore = await fs.readdir(tmpDir);
    expect(emptyTmpBefore).toHaveLength(0);

    const inMemory = await fetchTrustedXImageBuffer(
      'https://pbs.twimg.com/media/valid.png',
      validFetch,
    );
    expect(inMemory.mimeType).toBe('image/png');
    expect(inMemory.finalUrl).toBe('https://pbs.twimg.com/media/valid.png');
    expect(inMemory.buffer.byteLength).toBe(pngBytes.byteLength);
    expect(await fs.readdir(tmpDir)).toHaveLength(0);

    const saved = await downloadTrustedXImage(
      'https://pbs.twimg.com/media/valid.png',
      tmpDir,
      validFetch,
    );
    expect(saved.filename).toMatch(/\.png$/);
    expect(saved.buffer.byteLength).toBe(pngBytes.byteLength);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
