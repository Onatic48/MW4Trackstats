import type { AppConfig } from '../../config.js';
import { MockXProvider } from './mockXProvider.js';
import { OfficialApiXProvider } from './officialApiXProvider.js';
import { PlaywrightXProvider } from './playwrightXProvider.js';
import type { XProvider } from './types.js';

export * from './types.js';
export * from './mediaDownload.js';
export { buildMockCombatRecordModes, renderMockCombatCardPng, MockXProvider } from './mockXProvider.js';
export { PlaywrightXProvider } from './playwrightXProvider.js';
export { OfficialApiXProvider } from './officialApiXProvider.js';

export function createXProvider(config: AppConfig): XProvider {
  if (config.xProvider === 'playwright') {
    return new PlaywrightXProvider({
      userDataDir: config.playwrightUserDataDir,
      headless: config.playwrightHeadless,
      botHandle: config.xBotHandle,
      pinnedTweetUrl: config.xPinnedTweetUrl,
      replyTimeoutMs: config.xReplyTimeoutMs,
      pollIntervalMs: config.xPollIntervalMs,
    });
  }

  if (config.xProvider === 'api') {
    return new OfficialApiXProvider({
      bearerToken: config.xApiBearerToken,
      apiKey: config.xApiKey,
      apiSecret: config.xApiSecret,
      accessToken: config.xAccessToken,
      accessSecret: config.xAccessSecret,
      botHandle: config.xBotHandle,
      pinnedTweetId: config.xPinnedTweetId,
      replyTimeoutMs: config.xReplyTimeoutMs,
      pollIntervalMs: config.xPollIntervalMs,
      oauth2Configured: config.oauth2Configured,
    });
  }

  return new MockXProvider({
    botHandle: config.xBotHandle,
    stepDelayMs: config.mockStepDelayMs,
  });
}
