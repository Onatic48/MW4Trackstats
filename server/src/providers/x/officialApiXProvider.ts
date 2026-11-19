import crypto from 'node:crypto';
import {
  XAuthRequiredError,
  XBotNoStatsError,
  XBotTimeoutError,
  XRateLimitError,
  type XCombatRecordMedia,
  type XProvider,
  type XRequestCallbacks,
  type XUserContext,
} from './types.js';

const REQUEST_TIMEOUT_MS = 10_000;

type PollOutcome =
  | { kind: 'found'; media: XCombatRecordMedia }
  | { kind: 'empty' }
  | { kind: 'forbidden'; status: number; detail: string }
  | { kind: 'rate_limited'; message: string };

function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'TimeoutError' || err.name === 'AbortError')
  );
}

function rfc3986Encode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function buildMentionTweetVariants(botHandle: string, activisionId: string): string[] {
  const mention = `@${botHandle}`;
  return [
    `${mention} Call of Duty ${activisionId}`,
    `${activisionId} ${mention} Call of Duty`,
    `${mention}, Call of Duty, ${activisionId}`,
    `${mention}\nCall of Duty\n${activisionId}`,
    `${activisionId}\n${mention}\nCall of Duty`,
    `Call of Duty ${mention} ${activisionId}`,
    `${activisionId}, ${mention}, Call of Duty`,
    `Call of Duty\n${mention}\n${activisionId}`,
  ];
}

export function buildOAuth1Header(params: {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}): string {
  const parsedUrl = new URL(params.url);
  const baseUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: params.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: params.token,
    oauth_version: '1.0',
  };

  const allParams: Array<[string, string]> = [];
  for (const [k, v] of parsedUrl.searchParams.entries()) {
    allParams.push([rfc3986Encode(k), rfc3986Encode(v)]);
  }
  for (const [k, v] of Object.entries(oauthParams)) {
    allParams.push([rfc3986Encode(k), rfc3986Encode(v)]);
  }

  allParams.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const paramString = allParams.map(([k, v]) => `${k}=${v}`).join('&');

  const baseString = [
    params.method.toUpperCase(),
    rfc3986Encode(baseUrl),
    rfc3986Encode(paramString),
  ].join('&');

  const signingKey = `${rfc3986Encode(params.consumerSecret)}&${rfc3986Encode(params.tokenSecret)}`;
  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64');

  const headerPairs = Object.entries({
    ...oauthParams,
    oauth_signature: signature,
  }).map(([k, v]) => `${rfc3986Encode(k)}="${rfc3986Encode(v)}"`);

  return `OAuth ${headerPairs.join(', ')}`;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractXApiErrorDetail(rawText: string): string {
  if (!rawText) {
    return '';
  }
  try {
    const parsed = JSON.parse(rawText) as {
      detail?: string;
      title?: string;
      errors?: Array<{ message?: string; detail?: string }>;
    };
    const firstErr = parsed.errors?.[0];
    return (
      parsed.detail ||
      firstErr?.detail ||
      firstErr?.message ||
      parsed.title ||
      rawText
    ).trim();
  } catch {
    return rawText.trim();
  }
}

interface XApiUsersMeResponse {
  data?: {
    id?: string;
    username?: string;
  };
}

interface XApiTweetResponse {
  data?: { id?: string };
  detail?: string;
}

interface XApiTimelineResponse {
  data?: Array<{
    id: string;
    author_id?: string;
    text?: string;
    created_at?: string;
    referenced_tweets?: Array<{ type: string; id: string }>;
    attachments?: { media_keys?: string[] };
  }>;
  includes?: {
    media?: Array<{
      media_key: string;
      type: string;
      url?: string;
    }>;
    users?: Array<{
      id: string;
      username?: string;
    }>;
  };
}

export class OfficialApiXProvider implements XProvider {
  readonly name = 'api' as const;
  private readonly fetchImpl: typeof fetch;
  private cachedMe: { id: string; username: string } | null = null;

  constructor(
    private readonly options: {
      bearerToken: string;
      apiKey: string;
      apiSecret: string;
      accessToken: string;
      accessSecret: string;
      botHandle: string;
      pinnedTweetId: string;
      replyTimeoutMs: number;
      pollIntervalMs: number;
      oauth2Configured?: boolean;
      fetchImpl?: typeof fetch;
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private hasWriteCredentials(): boolean {
    return Boolean(
      this.options.apiKey &&
        this.options.apiSecret &&
        this.options.accessToken &&
        this.options.accessSecret,
    );
  }

  private buildOAuthHeader(method: string, url: string): string {
    return buildOAuth1Header({
      method,
      url,
      consumerKey: this.options.apiKey,
      consumerSecret: this.options.apiSecret,
      token: this.options.accessToken,
      tokenSecret: this.options.accessSecret,
    });
  }

  async verifyCredentials(): Promise<{ id: string; username: string }> {
    if (!this.hasWriteCredentials()) {
      throw new XAuthRequiredError(
        'Official X API credentials missing (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET)',
      );
    }

    const meUrl = 'https://api.x.com/2/users/me';
    const resp = await this.fetchImpl(meUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: this.buildOAuthHeader('GET', meUrl),
      },
    });

    if (resp.status === 429) {
      throw new XRateLimitError('Official X API rate limit reached while verifying credentials');
    }

    const rawText = await resp.text();
    if (resp.status === 401 || resp.status === 402 || resp.status === 403) {
      const detail = extractXApiErrorDetail(rawText);
      throw new XAuthRequiredError(
        `Official X API rejected credentials (HTTP ${resp.status})${detail ? `: ${detail}` : ''}`,
      );
    }

    if (!resp.ok) {
      throw new Error(
        `Official X API GET /2/users/me failed (${resp.status}): ${extractXApiErrorDetail(rawText)}`,
      );
    }

    const parsed = JSON.parse(rawText) as XApiUsersMeResponse;
    const id = parsed.data?.id;
    const username = parsed.data?.username;
    if (!id || !username) {
      throw new Error('Official X API GET /2/users/me returned incomplete user profile');
    }

    this.cachedMe = { id, username };
    return this.cachedMe;
  }

  private async resolveAuthenticatedUser(): Promise<{ id: string; username: string }> {
    if (this.cachedMe) {
      return this.cachedMe;
    }
    return this.verifyCredentials();
  }

  private async postMentionTweet(
    text: string,
    userAccessToken?: string,
  ): Promise<{ ok: true; tweetId: string } | { ok: false; status: number; bodyText: string }> {
    const postUrl = 'https://api.x.com/2/tweets';
    const authorization = userAccessToken
      ? `Bearer ${userAccessToken}`
      : this.buildOAuthHeader('POST', postUrl);

    const postResp = await this.fetchImpl(postUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
      }),
    });

    const bodyText = await postResp.text();
    if (!postResp.ok) {
      return { ok: false, status: postResp.status, bodyText };
    }

    const postJson = JSON.parse(bodyText) as XApiTweetResponse;
    const postedTweetId = postJson.data?.id;
    if (!postedTweetId) {
      throw new Error('Official X API returned no tweet ID after posting mention');
    }

    return { ok: true, tweetId: postedTweetId };
  }

  private extractBotReplyFromTimeline(
    timelineJson: XApiTimelineResponse,
    postedTweetId: string,
    activisionId: string,
    assumeFromBot: boolean,
  ): { replyTweetId: string; imageUrl: string } | null {
    const mediaMap = new Map<string, string>();
    for (const m of timelineJson.includes?.media ?? []) {
      if (m.url && m.type === 'photo') {
        mediaMap.set(m.media_key, m.url);
      }
    }

    const userMap = new Map<string, string>();
    for (const u of timelineJson.includes?.users ?? []) {
      if (u.username) {
        userMap.set(u.id, u.username.toLowerCase());
      }
    }

    const botHandleLower = this.options.botHandle.toLowerCase();
    const idLower = activisionId.toLowerCase();

    for (const tweet of timelineJson.data ?? []) {
      const authorUsername = tweet.author_id ? userMap.get(tweet.author_id) : undefined;
      const isFromBot = authorUsername ? authorUsername === botHandleLower : assumeFromBot;
      if (!isFromBot) {
        continue;
      }

      const repliesToOurs = tweet.referenced_tweets?.some(
        (ref) => ref.type === 'replied_to' && ref.id === postedTweetId,
      );
      const mentionsQueriedId = Boolean(tweet.text?.toLowerCase().includes(idLower));

      if (!repliesToOurs && !mentionsQueriedId) {
        continue;
      }

      const firstMediaKey = tweet.attachments?.media_keys?.[0];
      const mediaUrl = firstMediaKey ? mediaMap.get(firstMediaKey) : undefined;
      if (mediaUrl) {
        return {
          replyTweetId: tweet.id,
          imageUrl: mediaUrl,
        };
      }

      const replyText = tweet.text?.trim() || 'Bot replied without a combat record image';
      if (
        /maximum amount of requests|daily limit|reached.*limit|try again tomorrow/i.test(
          replyText,
        )
      ) {
        throw new XRateLimitError(replyText);
      }

      throw new XBotNoStatsError(replyText);
    }

    return null;
  }

  private appendTimelineParams(url: URL, postedTweetId: string): void {
    url.searchParams.set('since_id', postedTweetId);
    url.searchParams.set(
      'tweet.fields',
      'author_id,created_at,referenced_tweets,attachments,text',
    );
    url.searchParams.set('expansions', 'attachments.media_keys,author_id');
    url.searchParams.set('media.fields', 'url,type');
    url.searchParams.set('user.fields', 'username');
    url.searchParams.set('max_results', '10');
  }

  private async pollMentions(
    me: { id: string; username: string },
    postedTweetId: string,
    activisionId: string,
    userContext?: XUserContext,
  ): Promise<PollOutcome> {
    const mentionsUrl = new URL(`https://api.x.com/2/users/${me.id}/mentions`);
    this.appendTimelineParams(mentionsUrl, postedTweetId);

    const mentionsUrlStr = mentionsUrl.toString();
    const mentionsAuth = userContext
      ? `Bearer ${userContext.accessToken}`
      : this.buildOAuthHeader('GET', mentionsUrlStr);

    let resp: Response;
    try {
      resp = await this.fetchImpl(mentionsUrlStr, {
        method: 'GET',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: mentionsAuth,
        },
      });
    } catch (err) {
      if (isTimeoutError(err)) {
        return { kind: 'empty' };
      }
      throw err;
    }

    if (resp.status === 429) {
      return {
        kind: 'rate_limited',
        message: 'Official X API rate limit reached while polling mentions',
      };
    }

    if (resp.ok) {
      const json = (await resp.json()) as XApiTimelineResponse;
      const match = this.extractBotReplyFromTimeline(
        json,
        postedTweetId,
        activisionId,
        false,
      );
      return match ? { kind: 'found', media: match } : { kind: 'empty' };
    }

    const rawText = await resp.text();
    if (resp.status === 401 || resp.status === 402 || resp.status === 403) {
      return {
        kind: 'forbidden',
        status: resp.status,
        detail: extractXApiErrorDetail(rawText),
      };
    }

    return { kind: 'empty' };
  }

  private async pollRecentSearch(
    me: { id: string; username: string },
    postedTweetId: string,
    activisionId: string,
    userContext?: XUserContext,
  ): Promise<PollOutcome> {
    const searchUrl = new URL('https://api.x.com/2/tweets/search/recent');
    searchUrl.searchParams.set(
      'query',
      `from:${this.options.botHandle} (conversation_id:${postedTweetId} OR to:${me.username})`,
    );
    this.appendTimelineParams(searchUrl, postedTweetId);

    const searchUrlStr = searchUrl.toString();
    const authHeader = this.options.bearerToken
      ? `Bearer ${this.options.bearerToken}`
      : userContext?.accessToken
        ? `Bearer ${userContext.accessToken}`
        : this.buildOAuthHeader('GET', searchUrlStr);

    let resp: Response;
    try {
      resp = await this.fetchImpl(searchUrlStr, {
        method: 'GET',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: authHeader,
        },
      });
    } catch (err) {
      if (isTimeoutError(err)) {
        return { kind: 'empty' };
      }
      throw err;
    }

    if (resp.status === 429) {
      return {
        kind: 'rate_limited',
        message: 'Official X API rate limit reached while polling recent search',
      };
    }

    const rawText = await resp.text();
    if (resp.status === 401 || resp.status === 402 || resp.status === 403) {
      return {
        kind: 'forbidden',
        status: resp.status,
        detail: extractXApiErrorDetail(rawText),
      };
    }

    if (!resp.ok) {
      return { kind: 'empty' };
    }

    const searchJson = JSON.parse(rawText) as XApiTimelineResponse;
    const match = this.extractBotReplyFromTimeline(
      searchJson,
      postedTweetId,
      activisionId,
      true,
    );
    return match ? { kind: 'found', media: match } : { kind: 'empty' };
  }

  async requestCombatRecord(
    activisionId: string,
    callbacks: XRequestCallbacks,
    userContext?: XUserContext,
  ): Promise<XCombatRecordMedia> {
    const me = userContext
      ? { id: userContext.xUserId, username: userContext.xUsername }
      : await this.resolveAuthenticatedUser();
    const variants = buildMentionTweetVariants(this.options.botHandle, activisionId);

    let postAttempt = await this.postMentionTweet(variants[0]!, userContext?.accessToken);
    for (
      let variantIdx = 1;
      variantIdx < variants.length &&
      !postAttempt.ok &&
      postAttempt.status === 403 &&
      postAttempt.bodyText.toLowerCase().includes('duplicate content');
      variantIdx += 1
    ) {
      postAttempt = await this.postMentionTweet(
        variants[variantIdx]!,
        userContext?.accessToken,
      );
    }

    if (!postAttempt.ok) {
      const detail = extractXApiErrorDetail(postAttempt.bodyText);
      if (postAttempt.status === 429) {
        throw new XRateLimitError(
          `Official X API rate limit reached while posting${detail ? `: ${detail}` : ''}`,
        );
      }
      if (postAttempt.status === 401 || postAttempt.status === 402 || postAttempt.status === 403) {
        throw new XAuthRequiredError(
          `Official X API rejected post (HTTP ${postAttempt.status})${detail ? `: ${detail}` : ''}`,
        );
      }
      throw new Error(
        `Official X API POST /2/tweets failed (${postAttempt.status}): ${detail}`,
      );
    }

    const postedTweetId = postAttempt.tweetId;
    callbacks.onTweetPosted(postedTweetId);
    callbacks.onWaitingForReply();

    const deadline = Date.now() + this.options.replyTimeoutMs;
    const canUseSearch = Boolean(this.options.bearerToken || userContext?.accessToken);
    let mentionsDisabled = false;
    let searchDisabled = !canUseSearch;
    let pollIndex = 0;

    const runMentionsStep = async (): Promise<XCombatRecordMedia | null> => {
      const res = await this.pollMentions(me, postedTweetId, activisionId, userContext);
      if (res.kind === 'found') {
        return res.media;
      }
      if (res.kind === 'rate_limited') {
        if (!searchDisabled) {
          mentionsDisabled = true;
          return null;
        }
        throw new XRateLimitError(res.message);
      }
      if (res.kind === 'forbidden') {
        if (!searchDisabled) {
          mentionsDisabled = true;
          return null;
        }
        throw new XAuthRequiredError(
          `Official X API rejected mentions read (HTTP ${res.status})${res.detail ? `: ${res.detail}` : ''}`,
        );
      }
      return null;
    };

    const runSearchStep = async (): Promise<XCombatRecordMedia | null> => {
      const res = await this.pollRecentSearch(me, postedTweetId, activisionId, userContext);
      if (res.kind === 'found') {
        return res.media;
      }
      if (res.kind === 'rate_limited') {
        if (!mentionsDisabled) {
          searchDisabled = true;
          return null;
        }
        throw new XRateLimitError(res.message);
      }
      if (res.kind === 'forbidden') {
        if (!mentionsDisabled) {
          searchDisabled = true;
          return null;
        }
        throw new XAuthRequiredError(
          `Official X API rejected reply lookup (HTTP ${res.status})${res.detail ? `: ${res.detail}` : ''}`,
        );
      }
      return null;
    };

    while (Date.now() < deadline) {
      const waitMs =
        pollIndex === 0
          ? this.options.pollIntervalMs === 0
            ? 0
            : Math.min(this.options.pollIntervalMs, 1500)
          : this.options.pollIntervalMs;
      await sleep(waitMs);

      if (pollIndex === 0) {
        if (!mentionsDisabled) {
          const found = await runMentionsStep();
          if (found) {
            return found;
          }
        }
        if (!searchDisabled) {
          const found = await runSearchStep();
          if (found) {
            return found;
          }
        }
      } else if (!searchDisabled) {
        const found = await runSearchStep();
        if (found) {
          return found;
        }
        if (!mentionsDisabled && pollIndex % 2 === 0) {
          const backupFound = await runMentionsStep();
          if (backupFound) {
            return backupFound;
          }
        }
      } else if (!mentionsDisabled) {
        const found = await runMentionsStep();
        if (found) {
          return found;
        }
      }

      pollIndex += 1;
    }

    throw new XBotTimeoutError(
      `Bot @${this.options.botHandle} did not reply via X API within ${Math.round(this.options.replyTimeoutMs / 1000)}s`,
    );
  }

  async healthCheck(): Promise<{ ready: boolean; detail: string }> {
    const hasOAuth1 = this.hasWriteCredentials();
    const hasOAuth2 = Boolean(this.options.oauth2Configured);
    const ready = hasOAuth1 || hasOAuth2;

    if (hasOAuth2 && hasOAuth1) {
      return {
        ready: true,
        detail: 'Official X API v2 active (OAuth 2.0 user sign-in + OAuth 1.0a)',
      };
    }
    if (hasOAuth2) {
      return {
        ready: true,
        detail: 'Official X API v2 OAuth 2.0 user login configured',
      };
    }
    return {
      ready,
      detail: ready
        ? 'Official X API v2 OAuth 1.0a credentials configured'
        : 'Official X API v2 credentials missing in .env',
    };
  }
}
