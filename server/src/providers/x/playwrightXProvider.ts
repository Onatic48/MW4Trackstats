import fs from 'node:fs';
import { chromium, type BrowserContext, type Page } from 'playwright';
import {
  XAuthRequiredError,
  XBotNoStatsError,
  XBotTimeoutError,
  XChallengeRequiredError,
  XRateLimitError,
  type XCombatRecordMedia,
  type XProvider,
  type XRequestCallbacks,
} from './types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertNoAuthOrChallengeWall(page: Page): Promise<void> {
  const url = page.url().toLowerCase();
  if (url.includes('/i/flow/login') || url.includes('/login')) {
    throw new XAuthRequiredError(
      'X session is not logged in. Run "npm run x:login" to sign in manually.',
    );
  }
  if (url.includes('/account/access') || url.includes('/i/flow/consent')) {
    throw new XChallengeRequiredError(
      'X requires account verification or challenge. Complete verification manually via npm run x:login.',
    );
  }

  const loginButtonVisible = await page
    .locator('[data-testid="loginButton"], a[href="/login"]')
    .first()
    .isVisible()
    .catch(() => false);
  const replyTextareaVisible = await page
    .locator('[data-testid="tweetTextarea_0"]')
    .first()
    .isVisible()
    .catch(() => false);

  if (loginButtonVisible && !replyTextareaVisible) {
    throw new XAuthRequiredError(
      'X guest view detected (not authenticated). Run "npm run x:login" first.',
    );
  }

  const challengeFrameVisible = await page
    .locator(
      'iframe[src*="arkose"], iframe[src*="funcaptcha"], iframe[src*="recaptcha"], iframe[src*="turnstile"]',
    )
    .first()
    .isVisible()
    .catch(() => false);

  if (challengeFrameVisible) {
    throw new XChallengeRequiredError(
      'CAPTCHA or anti-bot challenge detected on X. Automation stopped safely without bypassing.',
    );
  }
}

function upgradeTwimgUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname.endsWith('twimg.com')) {
      parsed.searchParams.set('name', 'large');
      return parsed.toString();
    }
  } catch {
    // Keep original URL if unparseable
  }
  return rawUrl;
}

export class PlaywrightXProvider implements XProvider {
  readonly name = 'playwright' as const;

  constructor(
    private readonly options: {
      userDataDir: string;
      headless: boolean;
      botHandle: string;
      pinnedTweetUrl: string;
      replyTimeoutMs: number;
      pollIntervalMs: number;
    },
  ) {}

  async requestCombatRecord(
    activisionId: string,
    callbacks: XRequestCallbacks,
  ): Promise<XCombatRecordMedia> {
    if (!fs.existsSync(this.options.userDataDir)) {
      throw new XAuthRequiredError(
        `Playwright X profile not found at ${this.options.userDataDir}. Run "npm run x:login" first.`,
      );
    }

    let context: BrowserContext | null = null;
    try {
      context = await chromium.launchPersistentContext(this.options.userDataDir, {
        headless: this.options.headless,
        viewport: { width: 1280, height: 900 },
      });

      const page = context.pages()[0] ?? (await context.newPage());
      page.setDefaultTimeout(20000);

      await page.goto(this.options.pinnedTweetUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('article[data-testid="tweet"], [data-testid="loginButton"]', {
        timeout: 15000,
      }).catch(() => undefined);

      await assertNoAuthOrChallengeWall(page);

      const replyBox = page.locator('[data-testid="tweetTextarea_0"]').first();
      await replyBox.waitFor({ state: 'visible', timeout: 15000 });
      await replyBox.click();

      const mentionText = `@${this.options.botHandle} Call of Duty ${activisionId}`;
      await page.keyboard.type(mentionText, { delay: 18 });

      const sendButton = page
        .locator('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]')
        .first();
      await sendButton.waitFor({ state: 'visible', timeout: 10000 });

      const postedAtMs = Date.now();
      await sendButton.click();

      // Briefly monitor for immediate X error toasts (rate limit / duplicate tweet)
      await sleep(2000);
      const toastText = await page
        .locator('[data-testid="toast"]')
        .first()
        .textContent()
        .catch(() => null);

      if (toastText) {
        const lower = toastText.toLowerCase();
        if (lower.includes('rate limit') || lower.includes('limit exceeded')) {
          throw new XRateLimitError(`X returned rate-limit notice: ${toastText.trim()}`);
        }
        if (lower.includes('verify') || lower.includes('locked')) {
          throw new XChallengeRequiredError(`X account verification required: ${toastText.trim()}`);
        }
      }

      const syntheticReplyId = `pw-${postedAtMs}`;
      callbacks.onTweetPosted(syntheticReplyId);
      callbacks.onWaitingForReply();

      const idSuffix = activisionId.split('#')[1] ?? activisionId;
      const deadline = Date.now() + this.options.replyTimeoutMs;

      while (Date.now() < deadline) {
        await sleep(this.options.pollIntervalMs);

        await page.goto('https://x.com/notifications/mentions', {
          waitUntil: 'domcontentloaded',
        });
        await assertNoAuthOrChallengeWall(page);
        await page
          .waitForSelector('article[data-testid="tweet"]', { timeout: 8000 })
          .catch(() => undefined);

        const match = await page.evaluate(
          ({ botHandleLower, suffix, minTimeMs }) => {
            const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
            for (const article of articles) {
              const text = (article.textContent ?? '').toLowerCase();
              const isFromBot =
                text.includes(`@${botHandleLower}`) ||
                Boolean(
                  article.querySelector(`a[href*="/${botHandleLower}" i]`),
                );
              if (!isFromBot) {
                continue;
              }

              const timeEl = article.querySelector('time');
              const datetimeAttr = timeEl?.getAttribute('datetime');
              if (datetimeAttr) {
                const parsedMs = Date.parse(datetimeAttr);
                if (Number.isFinite(parsedMs) && parsedMs < minTimeMs - 15000) {
                  continue;
                }
              }

              const statusLink = article.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
              const href = statusLink?.getAttribute('href') ?? '';
              const statusMatch = /\/status\/(\d+)/.exec(href);

              const mediaImg = article.querySelector<HTMLImageElement>(
                'img[src*="pbs.twimg.com/media/"]',
              );

              if (mediaImg?.src && (text.includes(suffix.toLowerCase()) || !suffix)) {
                return {
                  kind: 'image' as const,
                  replyTweetId: statusMatch?.[1] ?? `bot-${Date.now()}`,
                  imageUrl: mediaImg.src,
                };
              }

              if (
                text.includes('could not find') ||
                text.includes('no stats') ||
                text.includes('private') ||
                text.includes('unable to find')
              ) {
                return {
                  kind: 'no_stats' as const,
                  message: article.textContent?.trim() ?? 'No stats found',
                };
              }
            }
            return null;
          },
          {
            botHandleLower: this.options.botHandle.toLowerCase(),
            suffix: idSuffix,
            minTimeMs: postedAtMs,
          },
        );

        if (match?.kind === 'no_stats') {
          throw new XBotNoStatsError(match.message);
        }

        if (match?.kind === 'image') {
          return {
            replyTweetId: match.replyTweetId,
            imageUrl: upgradeTwimgUrl(match.imageUrl),
          };
        }
      }

      throw new XBotTimeoutError(
        `Bot @${this.options.botHandle} did not reply with an image within ${Math.round(this.options.replyTimeoutMs / 1000)}s`,
      );
    } finally {
      if (context) {
        await context.close().catch(() => undefined);
      }
    }
  }

  async healthCheck(): Promise<{ ready: boolean; detail: string }> {
    const profileExists = fs.existsSync(this.options.userDataDir);
    return {
      ready: profileExists,
      detail: profileExists
        ? `Playwright persistent profile found (${this.options.headless ? 'headless' : 'headed'})`
        : 'Playwright profile missing. Run "npm run x:login" to sign in to X',
    };
  }
}
