export type GameModeKey = 'multiplayer' | 'dmz' | 'battleRoyale' | 'resurgence';

export type XProviderKind = 'mock' | 'playwright' | 'api';
export type ParserProviderKind = 'gemini' | 'tesseract' | 'mock';

export interface MultiplayerStats {
  timePlayed: string | null;
  timePlayedMinutes: number | null;
  kills: number | null;
  kdRatio: number | null;
  highestStreak: number | null;
  wins: number | null;
  gamesPlayed?: number | null;
  winLossRatio?: number | null;
  accuracyPercent?: number | null;
}

export interface DmzStats {
  timePlayed: string | null;
  timePlayedMinutes: number | null;
  playerEliminations: number | null;
  hostileEliminations: number | null;
  containersOpened: number | null;
  successfulExfils: number | null;
  dynamicOps?: number | null;
  gamesPlayed?: number | null;
  medicalItems?: number | null;
}

export interface WarzoneModeStats {
  timePlayed: string | null;
  timePlayedMinutes: number | null;
  kills: number | null;
  kdRatio: number | null;
  highestKillsPerGame: number | null;
  wins: number | null;
  gamesPlayed?: number | null;
  winLossRatio?: number | null;
  accuracyPercent?: number | null;
}

export interface CombatRecordModes {
  multiplayer: MultiplayerStats;
  dmz: DmzStats;
  battleRoyale: WarzoneModeStats;
  resurgence: WarzoneModeStats;
}

export interface CombatRecordStats {
  activisionId: string;
  normalizedId: string;
  parsedActivisionId: string | null;
  season: string;
  sourceBotHandle: string;
  replyTweetId: string | null;
  imageUrl: string | null;
  localImagePath: string | null;
  fetchedAt: string;
  expiresAt: string;
  parserProvider: ParserProviderKind;
  xProvider: XProviderKind;
  cardLayout?: 'multi_mode' | 'single_mode';
  modes: CombatRecordModes;
}

export type JobStep =
  | 'queued'
  | 'posting_tweet'
  | 'waiting_bot_reply'
  | 'downloading_image'
  | 'parsing_image'
  | 'completed'
  | 'failed';

export type JobState = 'queued' | 'running' | 'completed' | 'failed';

export type JobErrorCode =
  | 'INVALID_ID'
  | 'RATE_LIMITED'
  | 'X_RATE_LIMITED'
  | 'X_CHALLENGE_REQUIRED'
  | 'X_AUTH_REQUIRED'
  | 'USER_X_LOGIN_REQUIRED'
  | 'BOT_TIMEOUT'
  | 'BOT_NO_STATS'
  | 'IMAGE_DOWNLOAD_FAILED'
  | 'PARSE_FAILED'
  | 'INTERNAL_ERROR';

export interface JobErrorInfo {
  code: JobErrorCode;
  message: string;
}

export interface JobStatusResponse {
  jobId: string;
  activisionId: string;
  normalizedId: string;
  state: JobState;
  step: JobStep;
  queuePosition: number;
  deduplicated?: boolean;
  createdAt: string;
  updatedAt: string;
  result: CombatRecordStats | null;
  staleData: CombatRecordStats | null;
  error: JobErrorInfo | null;
}

export type StatsLookupResponse =
  | {
      status: 'cached';
      activisionId: string;
      data: CombatRecordStats;
    }
  | {
      status: 'queued';
      jobId: string;
      activisionId: string;
      step: JobStep;
      queuePosition: number;
      deduplicated: boolean;
      staleData: CombatRecordStats | null;
    };

export interface RecentPlayerSummary {
  activisionId: string;
  normalizedId: string;
  season: string;
  fetchedAt: string;
  expiresAt: string;
  isFresh: boolean;
  multiplayerKd: number | null;
  resurgenceKills: number | null;
  dmzExfils: number | null;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  oauthConfigured: boolean;
  user: {
    xUserId: string;
    username: string;
  } | null;
}

export interface HealthResponse {
  ok: boolean;
  xProvider: XProviderKind;
  parserProvider: ParserProviderKind;
  geminiModel: string;
  cacheTtlMinutes: number;
  queuePending: number;
  xReady: boolean;
  xDetail: string;
  oauth2Configured: boolean;
}
