import { z } from 'zod';
import {
  normalizeStatNumber,
  normalizeStatString,
  parseDurationToMinutes,
  type CombatRecordModes,
  type ParserProviderKind,
} from '@mw4trackstats/shared';

export interface ParsedCardResult {
  parsedActivisionId: string | null;
  season: string;
  cardLayout: 'multi_mode' | 'single_mode';
  modes: CombatRecordModes;
}

export interface ImageParser {
  readonly name: ParserProviderKind;
  parse(input: {
    buffer: Buffer;
    mimeType: string;
    activisionId: string;
  }): Promise<ParsedCardResult>;
}

export class ParseFailedError extends Error {
  readonly code = 'PARSE_FAILED' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ParseFailedError';
  }
}

const RawValueSchema = z.union([z.string(), z.number(), z.null()]).optional().default(null);

const EMPTY_MULTIPLAYER = {
  timePlayed: null,
  kills: null,
  kdRatio: null,
  highestStreak: null,
  wins: null,
  gamesPlayed: null,
  winLossRatio: null,
  accuracyPercent: null,
};

const EMPTY_DMZ = {
  timePlayed: null,
  playerEliminations: null,
  hostileEliminations: null,
  containersOpened: null,
  successfulExfils: null,
  dynamicOps: null,
  gamesPlayed: null,
  medicalItems: null,
};

const EMPTY_WARZONE = {
  timePlayed: null,
  kills: null,
  kdRatio: null,
  highestKillsPerGame: null,
  wins: null,
  gamesPlayed: null,
  winLossRatio: null,
  accuracyPercent: null,
};

export const RawParsedCardSchema = z.object({
  parsedActivisionId: RawValueSchema,
  season: z
    .string()
    .nullable()
    .optional()
    .transform((val) => val ?? 'Season 01'),
  multiplayer: z
    .object({
      timePlayed: RawValueSchema,
      kills: RawValueSchema,
      kdRatio: RawValueSchema,
      highestStreak: RawValueSchema,
      wins: RawValueSchema,
      gamesPlayed: RawValueSchema,
      winLossRatio: RawValueSchema,
      accuracyPercent: RawValueSchema,
    })
    .nullable()
    .optional()
    .transform((val) => val ?? EMPTY_MULTIPLAYER),
  dmz: z
    .object({
      timePlayed: RawValueSchema,
      playerEliminations: RawValueSchema,
      hostileEliminations: RawValueSchema,
      containersOpened: RawValueSchema,
      successfulExfils: RawValueSchema,
      dynamicOps: RawValueSchema,
      gamesPlayed: RawValueSchema,
      medicalItems: RawValueSchema,
    })
    .nullable()
    .optional()
    .transform((val) => val ?? EMPTY_DMZ),
  battleRoyale: z
    .object({
      timePlayed: RawValueSchema,
      kills: RawValueSchema,
      kdRatio: RawValueSchema,
      highestKillsPerGame: RawValueSchema,
      wins: RawValueSchema,
      gamesPlayed: RawValueSchema,
      winLossRatio: RawValueSchema,
      accuracyPercent: RawValueSchema,
    })
    .nullable()
    .optional()
    .transform((val) => val ?? EMPTY_WARZONE),
  resurgence: z
    .object({
      timePlayed: RawValueSchema,
      kills: RawValueSchema,
      kdRatio: RawValueSchema,
      highestKillsPerGame: RawValueSchema,
      wins: RawValueSchema,
      gamesPlayed: RawValueSchema,
      winLossRatio: RawValueSchema,
      accuracyPercent: RawValueSchema,
    })
    .nullable()
    .optional()
    .transform((val) => val ?? EMPTY_WARZONE),
});

export type RawParsedCard = z.infer<typeof RawParsedCardSchema>;

export function normalizeParsedCard(raw: unknown): ParsedCardResult {
  const parsed = RawParsedCardSchema.parse(raw);

  const mpTime = normalizeStatString(parsed.multiplayer.timePlayed);
  const dmzTime = normalizeStatString(parsed.dmz.timePlayed);
  const brTime = normalizeStatString(parsed.battleRoyale.timePlayed);
  const resTime = normalizeStatString(parsed.resurgence.timePlayed);

  const gamesPlayed = normalizeStatNumber(parsed.multiplayer.gamesPlayed);
  const winLossRatio = normalizeStatNumber(parsed.multiplayer.winLossRatio);
  const accuracyPercent = normalizeStatNumber(parsed.multiplayer.accuracyPercent);

  const dmzDynamicOps = normalizeStatNumber(parsed.dmz.dynamicOps);
  const dmzGamesPlayed = normalizeStatNumber(parsed.dmz.gamesPlayed);
  const dmzMedicalItems = normalizeStatNumber(parsed.dmz.medicalItems);

  const brGamesPlayed = normalizeStatNumber(parsed.battleRoyale.gamesPlayed);
  const brWinLossRatio = normalizeStatNumber(parsed.battleRoyale.winLossRatio);
  const brAccuracyPercent = normalizeStatNumber(parsed.battleRoyale.accuracyPercent);

  const resGamesPlayed = normalizeStatNumber(parsed.resurgence.gamesPlayed);
  const resWinLossRatio = normalizeStatNumber(parsed.resurgence.winLossRatio);
  const resAccuracyPercent = normalizeStatNumber(parsed.resurgence.accuracyPercent);

  const modes: CombatRecordModes = {
    multiplayer: {
      timePlayed: mpTime,
      timePlayedMinutes: parseDurationToMinutes(mpTime),
      kills: normalizeStatNumber(parsed.multiplayer.kills),
      kdRatio: normalizeStatNumber(parsed.multiplayer.kdRatio),
      highestStreak: normalizeStatNumber(parsed.multiplayer.highestStreak),
      wins: normalizeStatNumber(parsed.multiplayer.wins),
      ...(gamesPlayed !== null ? { gamesPlayed } : {}),
      ...(winLossRatio !== null ? { winLossRatio } : {}),
      ...(accuracyPercent !== null ? { accuracyPercent } : {}),
    },
    dmz: {
      timePlayed: dmzTime,
      timePlayedMinutes: parseDurationToMinutes(dmzTime),
      playerEliminations: normalizeStatNumber(parsed.dmz.playerEliminations),
      hostileEliminations: normalizeStatNumber(parsed.dmz.hostileEliminations),
      containersOpened: normalizeStatNumber(parsed.dmz.containersOpened),
      successfulExfils: normalizeStatNumber(parsed.dmz.successfulExfils),
      ...(dmzDynamicOps !== null ? { dynamicOps: dmzDynamicOps } : {}),
      ...(dmzGamesPlayed !== null ? { gamesPlayed: dmzGamesPlayed } : {}),
      ...(dmzMedicalItems !== null ? { medicalItems: dmzMedicalItems } : {}),
    },
    battleRoyale: {
      timePlayed: brTime,
      timePlayedMinutes: parseDurationToMinutes(brTime),
      kills: normalizeStatNumber(parsed.battleRoyale.kills),
      kdRatio: normalizeStatNumber(parsed.battleRoyale.kdRatio),
      highestKillsPerGame: normalizeStatNumber(parsed.battleRoyale.highestKillsPerGame),
      wins: normalizeStatNumber(parsed.battleRoyale.wins),
      ...(brGamesPlayed !== null ? { gamesPlayed: brGamesPlayed } : {}),
      ...(brWinLossRatio !== null ? { winLossRatio: brWinLossRatio } : {}),
      ...(brAccuracyPercent !== null ? { accuracyPercent: brAccuracyPercent } : {}),
    },
    resurgence: {
      timePlayed: resTime,
      timePlayedMinutes: parseDurationToMinutes(resTime),
      kills: normalizeStatNumber(parsed.resurgence.kills),
      kdRatio: normalizeStatNumber(parsed.resurgence.kdRatio),
      highestKillsPerGame: normalizeStatNumber(parsed.resurgence.highestKillsPerGame),
      wins: normalizeStatNumber(parsed.resurgence.wins),
      ...(resGamesPlayed !== null ? { gamesPlayed: resGamesPlayed } : {}),
      ...(resWinLossRatio !== null ? { winLossRatio: resWinLossRatio } : {}),
      ...(resAccuracyPercent !== null ? { accuracyPercent: resAccuracyPercent } : {}),
    },
  };

  const hasMp = modes.multiplayer.timePlayed !== null || modes.multiplayer.kills !== null;
  const hasDmz =
    modes.dmz.timePlayed !== null || modes.dmz.hostileEliminations !== null;
  const hasBr =
    modes.battleRoyale.timePlayed !== null || modes.battleRoyale.kills !== null;
  const hasRes =
    modes.resurgence.timePlayed !== null || modes.resurgence.kills !== null;

  const populatedModes = [hasMp, hasDmz, hasBr, hasRes].filter(Boolean).length;
  if (populatedModes === 0) {
    throw new ParseFailedError('Parsed combat record image contained no readable metrics');
  }

  return {
    parsedActivisionId: normalizeStatString(
      typeof parsed.parsedActivisionId === 'number'
        ? String(parsed.parsedActivisionId)
        : parsed.parsedActivisionId,
    ),
    season: parsed.season.trim() || 'Season 01',
    cardLayout: populatedModes === 1 ? 'single_mode' : 'multi_mode',
    modes,
  };
}
