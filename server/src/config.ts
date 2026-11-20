import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
import type { ParserProviderKind, XProviderKind } from '@mw4trackstats/shared';

export function findRepoRoot(startDir?: string): string {
  const initial =
    startDir ?? path.dirname(fileURLToPath(import.meta.url));
  let current = path.resolve(initial);
  for (let depth = 0; depth < 6; depth += 1) {
    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const raw = fs.readFileSync(pkgPath, 'utf8');
        const parsed = JSON.parse(raw) as { workspaces?: unknown };
        if (Array.isArray(parsed.workspaces)) {
          return current;
        }
      } catch {
        // Ignore malformed package.json while walking up
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return process.cwd();
}

export function loadRootEnv(repoRoot = findRepoRoot()): void {
  const candidates = [
    path.join(repoRoot, '.env'),
    path.join(process.cwd(), '.env'),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
      break;
    }
  }
}

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  CLIENT_ORIGIN: z.string().trim().min(1).default('http://localhost:5173'),
  SERVE_CLIENT_DIST: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .default('false'),

  DATABASE_PATH: z.string().trim().min(1).default('./server/data/mw4trackstats.sqlite'),
  IMAGES_DIR: z.string().trim().min(1).default('./server/data/images'),
  CACHE_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),

  X_PROVIDER: z.enum(['mock', 'playwright', 'api']).default('mock'),
  X_BOT_HANDLE: z.string().trim().min(1).default('CODCombatRecord'),
  X_PINNED_TWEET_URL: z
    .string()
    .trim()
    .url()
    .default('https://x.com/CODCombatRecord/status/2122766555675328664'),
  X_COOLDOWN_MS: z.coerce.number().int().min(0).max(300000).default(2000),
  X_REPLY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(45000),
  X_POLL_INTERVAL_MS: z.coerce.number().int().min(500).max(30000).default(1500),

  PLAYWRIGHT_USER_DATA_DIR: z
    .string()
    .trim()
    .min(1)
    .default('./server/data/playwright-profile'),
  PLAYWRIGHT_HEADLESS: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .default('true'),

  X_API_BEARER_TOKEN: z.string().optional().default(''),
  X_API_KEY: z.string().optional().default(''),
  X_API_SECRET: z.string().optional().default(''),
  X_ACCESS_TOKEN: z.string().optional().default(''),
  X_ACCESS_SECRET: z.string().optional().default(''),

  X_OAUTH2_CLIENT_ID: z.string().optional().default(''),
  X_OAUTH2_CLIENT_SECRET: z.string().optional().default(''),
  X_OAUTH2_REDIRECT_URI: z
    .string()
    .trim()
    .url()
    .default('http://127.0.0.1:3001/callback'),
  SESSION_COOKIE_SECURE: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .default('false'),
  TRUST_PROXY: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .default('false'),

  PARSER_PROVIDER: z.enum(['gemini', 'tesseract', 'mock']).default('gemini'),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().trim().min(1).default('gemini-3.1-flash-lite'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86400000).default(900000),
  RATE_LIMIT_MAX_UNCACHED: z.coerce.number().int().min(1).max(1000).default(5),
  RATE_LIMIT_MAX_READS: z.coerce.number().int().min(1).max(5000).default(60),

  GOOGLE_SHEETS_WEBHOOK_URL: z.string().optional().default(''),
  GOOGLE_SHEETS_WEBHOOK_SECRET: z.string().optional().default(''),
});

export interface AppConfig {
  repoRoot: string;
  port: number;
  host: string;
  clientOrigin: string;
  serveClientDist: boolean;
  databasePath: string;
  imagesDir: string;
  cacheTtlMinutes: number;
  xProvider: XProviderKind;
  xBotHandle: string;
  xPinnedTweetUrl: string;
  xPinnedTweetId: string;
  xCooldownMs: number;
  xReplyTimeoutMs: number;
  xPollIntervalMs: number;
  playwrightUserDataDir: string;
  playwrightHeadless: boolean;
  xApiBearerToken: string;
  xApiKey: string;
  xApiSecret: string;
  xAccessToken: string;
  xAccessSecret: string;
  xOAuth2ClientId: string;
  xOAuth2ClientSecret: string;
  xOAuth2RedirectUri: string;
  sessionCookieSecure: boolean;
  trustProxy: boolean;
  oauth2Configured: boolean;
  parserProvider: ParserProviderKind;
  geminiApiKey: string;
  geminiModel: string;
  rateLimitWindowMs: number;
  rateLimitMaxUncached: number;
  rateLimitMaxReads: number;
  mockStepDelayMs: number;
  googleSheetsWebhookUrl: string;
  googleSheetsWebhookSecret: string;
}

export function extractTweetIdFromUrl(url: string): string {
  const match = /\/status\/(\d+)/.exec(url);
  if (!match || !match[1]) {
    throw new Error(`Invalid X_PINNED_TWEET_URL (missing /status/<id>): ${url}`);
  }
  return match[1];
}

function resolveFromRoot(repoRoot: string, targetPath: string): string {
  if (targetPath === ':memory:') {
    return targetPath;
  }
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(repoRoot, targetPath);
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  repoRoot = findRepoRoot(),
): AppConfig {
  const parsed = EnvSchema.parse(env);
  const pinnedTweetId = extractTweetIdFromUrl(parsed.X_PINNED_TWEET_URL);

  return {
    repoRoot,
    port: parsed.PORT,
    host: parsed.HOST,
    clientOrigin: parsed.CLIENT_ORIGIN,
    serveClientDist: parsed.SERVE_CLIENT_DIST === 'true' || parsed.SERVE_CLIENT_DIST === '1',
    databasePath: resolveFromRoot(repoRoot, parsed.DATABASE_PATH),
    imagesDir: resolveFromRoot(repoRoot, parsed.IMAGES_DIR),
    cacheTtlMinutes: parsed.CACHE_TTL_MINUTES,
    xProvider: parsed.X_PROVIDER,
    xBotHandle: parsed.X_BOT_HANDLE.replace(/^@/, ''),
    xPinnedTweetUrl: parsed.X_PINNED_TWEET_URL,
    xPinnedTweetId: pinnedTweetId,
    xCooldownMs: parsed.X_COOLDOWN_MS,
    xReplyTimeoutMs: parsed.X_REPLY_TIMEOUT_MS,
    xPollIntervalMs: parsed.X_POLL_INTERVAL_MS,
    playwrightUserDataDir: resolveFromRoot(repoRoot, parsed.PLAYWRIGHT_USER_DATA_DIR),
    playwrightHeadless: parsed.PLAYWRIGHT_HEADLESS === 'true' || parsed.PLAYWRIGHT_HEADLESS === '1',
    xApiBearerToken: parsed.X_API_BEARER_TOKEN.trim(),
    xApiKey: parsed.X_API_KEY.trim(),
    xApiSecret: parsed.X_API_SECRET.trim(),
    xAccessToken: parsed.X_ACCESS_TOKEN.trim(),
    xAccessSecret: parsed.X_ACCESS_SECRET.trim(),
    xOAuth2ClientId: parsed.X_OAUTH2_CLIENT_ID.trim(),
    xOAuth2ClientSecret: parsed.X_OAUTH2_CLIENT_SECRET.trim(),
    xOAuth2RedirectUri: parsed.X_OAUTH2_REDIRECT_URI.trim(),
    sessionCookieSecure:
      parsed.SESSION_COOKIE_SECURE === 'true' ||
      parsed.SESSION_COOKIE_SECURE === '1' ||
      parsed.CLIENT_ORIGIN.trim().toLowerCase().startsWith('https://'),
    trustProxy: parsed.TRUST_PROXY === 'true' || parsed.TRUST_PROXY === '1',
    oauth2Configured: Boolean(parsed.X_OAUTH2_CLIENT_ID.trim()),
    parserProvider: parsed.PARSER_PROVIDER,
    geminiApiKey: parsed.GEMINI_API_KEY.trim(),
    geminiModel: parsed.GEMINI_MODEL,
    rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
    rateLimitMaxUncached: parsed.RATE_LIMIT_MAX_UNCACHED,
    rateLimitMaxReads: parsed.RATE_LIMIT_MAX_READS,
    mockStepDelayMs: Number.parseInt(env.MOCK_STEP_DELAY_MS ?? '700', 10) || 700,
    googleSheetsWebhookUrl: parsed.GOOGLE_SHEETS_WEBHOOK_URL.trim(),
    googleSheetsWebhookSecret: parsed.GOOGLE_SHEETS_WEBHOOK_SECRET.trim(),
  };
}
