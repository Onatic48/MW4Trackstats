import { loadConfig, loadRootEnv } from '../config.js';
import { OfficialApiXProvider } from '../providers/x/officialApiXProvider.js';

async function main(): Promise<void> {
  loadRootEnv();
  const config = loadConfig();

  console.log(`[x:verify] Active X_PROVIDER: ${config.xProvider}`);
  console.log(
    `[x:verify] Gemini config: parser=${config.parserProvider}, model=${config.geminiModel}, apiKey=${config.geminiApiKey ? 'configured' : 'missing'}`,
  );
  console.log(
    `[x:verify] X Bearer Token: ${config.xApiBearerToken ? 'configured' : 'optional/not set'}`,
  );
  console.log(
    `[x:verify] X OAuth 2.0 Login: ${config.oauth2Configured ? `configured (redirect=${config.xOAuth2RedirectUri})` : 'not set (X_OAUTH2_CLIENT_ID empty)'}`,
  );

  const missing: string[] = [];
  if (!config.xApiKey) missing.push('X_API_KEY');
  if (!config.xApiSecret) missing.push('X_API_SECRET');
  if (!config.xAccessToken) missing.push('X_ACCESS_TOKEN');
  if (!config.xAccessSecret) missing.push('X_ACCESS_SECRET');

  if (missing.length > 0) {
    if (config.oauth2Configured) {
      console.log(
        `[x:verify] OAuth 1.0a keys omitted (${missing.join(', ')}); OAuth 2.0 user sign-in mode is active.`,
      );
      return;
    }
    console.error(`[x:verify] Missing required OAuth 1.0a env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const provider = new OfficialApiXProvider({
    bearerToken: config.xApiBearerToken,
    apiKey: config.xApiKey,
    apiSecret: config.xApiSecret,
    accessToken: config.xAccessToken,
    accessSecret: config.xAccessSecret,
    botHandle: config.xBotHandle,
    pinnedTweetId: config.xPinnedTweetId,
    replyTimeoutMs: config.xReplyTimeoutMs,
    pollIntervalMs: config.xPollIntervalMs,
  });

  const me = await provider.verifyCredentials();
  console.log(`[x:verify] OK — Authenticated as @${me.username} (id: ${me.id})`);
}

main().catch((err) => {
  console.error(
    '[x:verify] Failed:',
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
