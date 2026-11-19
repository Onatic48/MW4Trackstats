import crypto from 'node:crypto';
import sharp from 'sharp';
import {
  type CombatRecordModes,
  parseDurationToMinutes,
} from '@mw4trackstats/shared';
import type { XCombatRecordMedia, XProvider, XRequestCallbacks } from './types.js';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function formatDuration(minutes: number | null): string | null {
  if (minutes === null) {
    return null;
  }
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) {
    return `${days}D ${hours}H`;
  }
  if (hours > 0) {
    return `${hours}H ${mins}M`;
  }
  return `${mins}M`;
}

function deterministicSeed(input: string): number {
  const hash = crypto.createHash('sha256').update(input.toLowerCase()).digest();
  return hash.readUInt32BE(0);
}

export function buildMockCombatRecordModes(activisionId: string): CombatRecordModes {
  const normalized = activisionId.trim().toLowerCase();

  // Exact fixture matching the user's uploaded @CODCombatRecord Season 01 sample card (#5745488)
  if (normalized.endsWith('#5745488')) {
    return {
      multiplayer: {
        timePlayed: '1H 34M',
        timePlayedMinutes: 94,
        kills: 149,
        kdRatio: 1.33,
        highestStreak: 10,
        wins: 5,
      },
      dmz: {
        timePlayed: '4D 18H',
        timePlayedMinutes: 6840,
        playerEliminations: 10,
        hostileEliminations: 39101,
        containersOpened: 13431,
        successfulExfils: 359,
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
        timePlayed: '14M',
        timePlayedMinutes: 14,
        kills: 39,
        kdRatio: 0,
        highestKillsPerGame: 39,
        wins: 1,
      },
    };
  }

  if (normalized === 'captainprice#1412123') {
    return {
      multiplayer: {
        timePlayed: '2H 23M',
        timePlayedMinutes: 143,
        kills: 1895,
        kdRatio: 2.33,
        highestStreak: 26,
        wins: 103,
      },
      dmz: {
        timePlayed: '4H 18M',
        timePlayedMinutes: 258,
        playerEliminations: 18,
        hostileEliminations: 1892,
        containersOpened: 83,
        successfulExfils: 11,
      },
      battleRoyale: {
        timePlayed: '3H 10M',
        timePlayedMinutes: 190,
        kills: 114,
        kdRatio: 1.68,
        highestKillsPerGame: 19,
        wins: 4,
      },
      resurgence: {
        timePlayed: '1H 34M',
        timePlayedMinutes: 94,
        kills: 322,
        kdRatio: 0.93,
        highestKillsPerGame: 28,
        wins: 12,
      },
    };
  }

  const seed = deterministicSeed(normalized);
  const mpMins = 90 + (seed % 2800);
  const mpTime = formatDuration(mpMins);
  const dmzMins = 120 + ((seed >>> 3) % 5400);
  const dmzTime = formatDuration(dmzMins);
  const hasBr = (seed % 5) !== 0;
  const brMins = hasBr ? 45 + ((seed >>> 5) % 1900) : null;
  const brTime = formatDuration(brMins);
  const resMins = 25 + ((seed >>> 7) % 1600);
  const resTime = formatDuration(resMins);

  return {
    multiplayer: {
      timePlayed: mpTime,
      timePlayedMinutes: parseDurationToMinutes(mpTime),
      kills: 240 + (seed % 4200),
      kdRatio: Number((0.85 + ((seed % 185) / 100)).toFixed(2)),
      highestStreak: 6 + (seed % 24),
      wins: 8 + (seed % 190),
    },
    dmz: {
      timePlayed: dmzTime,
      timePlayedMinutes: parseDurationToMinutes(dmzTime),
      playerEliminations: 4 + ((seed >>> 4) % 95),
      hostileEliminations: 420 + ((seed >>> 2) % 28000),
      containersOpened: 180 + ((seed >>> 6) % 9500),
      successfulExfils: 12 + ((seed >>> 8) % 240),
    },
    battleRoyale: {
      timePlayed: brTime,
      timePlayedMinutes: parseDurationToMinutes(brTime),
      kills: hasBr ? 22 + ((seed >>> 9) % 720) : null,
      kdRatio: hasBr ? Number((0.72 + (((seed >>> 4) % 210) / 100)).toFixed(2)) : null,
      highestKillsPerGame: hasBr ? 5 + ((seed >>> 3) % 18) : null,
      wins: hasBr ? (seed >>> 11) % 34 : null,
    },
    resurgence: {
      timePlayed: resTime,
      timePlayedMinutes: parseDurationToMinutes(resTime),
      kills: 35 + ((seed >>> 10) % 980),
      kdRatio: Number((0.68 + (((seed >>> 5) % 195) / 100)).toFixed(2)),
      highestKillsPerGame: 6 + ((seed >>> 6) % 22),
      wins: 1 + ((seed >>> 12) % 45),
    },
  };
}

function renderCellSvg(x: number, y: number, label: string, value: string | number | null, fixedDecimals?: number): string {
  let display = '--';
  if (value !== null && value !== undefined) {
    if (typeof value === 'number' && fixedDecimals !== undefined) {
      display = value.toFixed(fixedDecimals);
    } else {
      display = String(value);
    }
  }
  return `
    <g transform="translate(${x}, ${y})">
      <rect width="196" height="86" rx="4" fill="#18181b" stroke="rgba(237,237,237,0.16)" stroke-width="1"/>
      <text x="14" y="24" fill="#a1a1a6" font-family="monospace" font-size="11">${escapeXml(label)}</text>
      <text x="14" y="64" fill="#ededed" font-family="monospace" font-size="28" font-weight="600">${escapeXml(display)}</text>
    </g>
  `;
}

export async function renderMockCombatCardPng(
  activisionId: string,
  modes: CombatRecordModes,
  botHandle: string,
): Promise<Buffer> {
  const safeId = escapeXml(activisionId);
  const safeBot = escapeXml(`@${botHandle.toUpperCase()}`);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
      <rect width="1280" height="720" fill="#0f0f10"/>
      <rect x="24" y="20" width="1232" height="680" rx="8" fill="#141415" stroke="rgba(237,237,237,0.1)"/>

      <text x="44" y="64" fill="#ededed" font-family="sans-serif" font-size="26" font-weight="700">CALL OF DUTY</text>
      <text x="234" y="64" fill="#eab308" font-family="sans-serif" font-size="26" font-weight="700">${safeBot}</text>
      <text x="1232" y="62" text-anchor="end" fill="#ededed" font-family="monospace" font-size="22">${safeId}</text>

      <line x1="44" y1="86" x2="1236" y2="86" stroke="rgba(237,237,237,0.12)" stroke-width="1"/>

      <!-- Column Headers -->
      <text x="142" y="130" text-anchor="middle" fill="#ededed" font-family="sans-serif" font-size="17" font-weight="600">MW4 MULTIPLAYER</text>
      <text x="356" y="130" text-anchor="middle" fill="#eab308" font-family="sans-serif" font-size="17" font-weight="600">DMZ</text>
      <text x="640" y="340" text-anchor="middle" fill="#52525b" font-family="monospace" font-size="14">SEASON 01 RECORD</text>
      <text x="640" y="366" text-anchor="middle" fill="#71717a" font-family="monospace" font-size="12">MW4TRACKSTATS DEMO CARD</text>
      <text x="924" y="130" text-anchor="middle" fill="#ededed" font-family="sans-serif" font-size="17" font-weight="600">BATTLE ROYALE</text>
      <text x="1138" y="130" text-anchor="middle" fill="#ededed" font-family="sans-serif" font-size="17" font-weight="600">RESURGENCE</text>

      <!-- Multiplayer Column -->
      ${renderCellSvg(44, 152, 'TIME PLAYED', modes.multiplayer.timePlayed)}
      ${renderCellSvg(44, 250, 'KILLS', modes.multiplayer.kills)}
      ${renderCellSvg(44, 348, 'K/D RATIO', modes.multiplayer.kdRatio, 2)}
      ${renderCellSvg(44, 446, 'HIGHEST STREAK', modes.multiplayer.highestStreak)}
      ${renderCellSvg(44, 544, 'WINS', modes.multiplayer.wins)}

      <!-- DMZ Column -->
      ${renderCellSvg(258, 152, 'TIME PLAYED', modes.dmz.timePlayed)}
      ${renderCellSvg(258, 250, 'PLAYER ELIMINATIONS', modes.dmz.playerEliminations)}
      ${renderCellSvg(258, 348, 'HOSTILE ELIMINATIONS', modes.dmz.hostileEliminations)}
      ${renderCellSvg(258, 446, 'CONTAINERS OPENED', modes.dmz.containersOpened)}
      ${renderCellSvg(258, 544, 'SUCCESSFUL EXFILS', modes.dmz.successfulExfils)}

      <!-- Battle Royale Column -->
      ${renderCellSvg(826, 152, 'TIME PLAYED', modes.battleRoyale.timePlayed)}
      ${renderCellSvg(826, 250, 'KILLS', modes.battleRoyale.kills)}
      ${renderCellSvg(826, 348, 'K/D RATIO', modes.battleRoyale.kdRatio, 2)}
      ${renderCellSvg(826, 446, 'HIGHEST KILLS/GAME', modes.battleRoyale.highestKillsPerGame)}
      ${renderCellSvg(826, 544, 'WINS', modes.battleRoyale.wins)}

      <!-- Resurgence Column -->
      ${renderCellSvg(1040, 152, 'TIME PLAYED', modes.resurgence.timePlayed)}
      ${renderCellSvg(1040, 250, 'KILLS', modes.resurgence.kills)}
      ${renderCellSvg(1040, 348, 'K/D RATIO', modes.resurgence.kdRatio, 2)}
      ${renderCellSvg(1040, 446, 'HIGHEST KILLS/GAME', modes.resurgence.highestKillsPerGame)}
      ${renderCellSvg(1040, 544, 'WINS', modes.resurgence.wins)}

      <text x="640" y="672" text-anchor="middle" fill="#a1a1a6" font-family="monospace" font-size="13">
        GENERATED BY LOCAL DEMO ADAPTER FOR @${escapeXml(botHandle.toUpperCase())}
      </text>
    </svg>
  `;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockXProvider implements XProvider {
  readonly name = 'mock' as const;

  constructor(
    private readonly options: {
      botHandle: string;
      stepDelayMs: number;
    },
  ) {}

  async requestCombatRecord(
    activisionId: string,
    callbacks: XRequestCallbacks,
  ): Promise<XCombatRecordMedia> {
    await sleep(this.options.stepDelayMs);
    const mockTweetId = `mock-${Date.now()}`;
    callbacks.onTweetPosted(mockTweetId);

    await sleep(this.options.stepDelayMs);
    callbacks.onWaitingForReply();

    await sleep(this.options.stepDelayMs);
    const modes = buildMockCombatRecordModes(activisionId);
    const pngBuffer = await renderMockCombatCardPng(
      activisionId,
      modes,
      this.options.botHandle,
    );

    return {
      replyTweetId: `reply-${Date.now()}`,
      localImageBuffer: pngBuffer,
      mimeType: 'image/png',
    };
  }

  async healthCheck(): Promise<{ ready: boolean; detail: string }> {
    return {
      ready: true,
      detail: 'Demo X adapter active (no live X account required)',
    };
  }
}
