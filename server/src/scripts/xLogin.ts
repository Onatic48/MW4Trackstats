import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { chromium } from 'playwright';
import { loadConfig, loadRootEnv } from '../config.js';

async function main(): Promise<void> {
  loadRootEnv();
  const config = loadConfig();

  fs.mkdirSync(config.playwrightUserDataDir, { recursive: true });
  console.log(`[x:login] Using persistent profile: ${config.playwrightUserDataDir}`);
  console.log('[x:login] Launching Chromium. Please sign in to X manually in the browser window.');

  const context = await chromium.launchPersistentContext(config.playwrightUserDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded' });

    const rl = readline.createInterface({ input, output });
    await rl.question(
      '\nAfter you finish logging into X (including any 2FA/verification), press Enter here to verify the pinned post... ',
    );
    rl.close();

    await page.goto(config.xPinnedTweetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const canReply = await page
      .locator('[data-testid="tweetTextarea_0"]')
      .first()
      .isVisible()
      .catch(() => false);

    if (canReply) {
      console.log('[x:login] Verified: X session is authenticated and reply composer is accessible.');
    } else {
      console.warn(
        '[x:login] Warning: Reply box was not immediately visible on the pinned post. Session cookies were still saved.',
      );
    }
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error('[x:login] Failed:', err);
  process.exit(1);
});
