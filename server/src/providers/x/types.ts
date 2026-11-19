import type { JobErrorCode, XProviderKind } from '@mw4trackstats/shared';

export interface XRequestCallbacks {
  onTweetPosted(tweetId: string): void;
  onWaitingForReply(): void;
}

export interface XCombatRecordMedia {
  replyTweetId: string;
  imageUrl?: string;
  localImageBuffer?: Buffer;
  mimeType?: string;
}

export interface XUserContext {
  accessToken: string;
  xUserId: string;
  xUsername: string;
}

export interface XProvider {
  readonly name: XProviderKind;
  requestCombatRecord(
    activisionId: string,
    callbacks: XRequestCallbacks,
    userContext?: XUserContext,
  ): Promise<XCombatRecordMedia>;
  healthCheck(): Promise<{ ready: boolean; detail: string }>;
}

export class XProviderError extends Error {
  constructor(
    public readonly code: JobErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'XProviderError';
  }
}

export class XRateLimitError extends XProviderError {
  constructor(message = 'X rate limit reached. Please retry after cooldown') {
    super('X_RATE_LIMITED', message);
    this.name = 'XRateLimitError';
  }
}

export class XChallengeRequiredError extends XProviderError {
  constructor(
    message = 'X requested interactive verification. Automation paused for manual review',
  ) {
    super('X_CHALLENGE_REQUIRED', message);
    this.name = 'XChallengeRequiredError';
  }
}

export class XAuthRequiredError extends XProviderError {
  constructor(
    message = 'X session authentication is required before automation can reply',
  ) {
    super('X_AUTH_REQUIRED', message);
    this.name = 'XAuthRequiredError';
  }
}

export class XBotTimeoutError extends XProviderError {
  constructor(message = 'Timed out waiting for @CODCombatRecord reply image') {
    super('BOT_TIMEOUT', message);
    this.name = 'XBotTimeoutError';
  }
}

export class XBotNoStatsError extends XProviderError {
  constructor(message = 'Bot could not locate public Season 01 stats for this Activision ID') {
    super('BOT_NO_STATS', message);
    this.name = 'XBotNoStatsError';
  }
}
