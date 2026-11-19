import { describe, it, expect, vi } from 'vitest';
import {
  buildOAuth1Header,
  OfficialApiXProvider,
} from '../providers/x/officialApiXProvider.js';
import {
  XAuthRequiredError,
  XBotNoStatsError,
  XRateLimitError,
} from '../providers/x/types.js';

function createProvider(fetchImpl: typeof fetch, bearerToken = '') {
  return new OfficialApiXProvider({
    bearerToken,
    apiKey: 'consumer-key',
    apiSecret: 'consumer-secret',
    accessToken: 'access-token',
    accessSecret: 'access-secret',
    botHandle: 'CODCombatRecord',
    pinnedTweetId: '2122766555675328664',
    replyTimeoutMs: 500,
    pollIntervalMs: 0,
    fetchImpl,
  });
}

describe('OfficialApiXProvider', () => {
  it('generates valid OAuth 1.0a HMAC-SHA1 authorization headers', () => {
    const header = buildOAuth1Header({
      method: 'POST',
      url: 'https://api.x.com/2/tweets',
      consumerKey: 'ck',
      consumerSecret: 'cs',
      token: 'tk',
      tokenSecret: 'ts',
    });

    expect(header.startsWith('OAuth ')).toBe(true);
    expect(header).toContain('oauth_consumer_key="ck"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header).toContain('oauth_token="tk"');
    expect(header).toContain('oauth_signature="');
  });

  it('completes full flow via /2/users/me -> /2/tweets -> /2/users/:id/mentions', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { id: '9001', username: 'mw4player' } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'tweet-100' } }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'bot-reply-200',
                author_id: 'bot-1',
                text: '@mw4player Here are your stats',
                referenced_tweets: [{ type: 'replied_to', id: 'tweet-100' }],
                attachments: { media_keys: ['m1'] },
              },
            ],
            includes: {
              users: [{ id: 'bot-1', username: 'CODCombatRecord' }],
              media: [
                {
                  media_key: 'm1',
                  type: 'photo',
                  url: 'https://pbs.twimg.com/media/card123.jpg',
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

    const provider = createProvider(mockFetch);
    const onTweetPosted = vi.fn();
    const onWaitingForReply = vi.fn();

    const result = await provider.requestCombatRecord('CaptainPrice#1412123', {
      onTweetPosted,
      onWaitingForReply,
    });

    expect(onTweetPosted).toHaveBeenCalledWith('tweet-100');
    expect(onWaitingForReply).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      replyTweetId: 'bot-reply-200',
      imageUrl: 'https://pbs.twimg.com/media/card123.jpg',
    });

    const postCallBody = JSON.parse(String(mockFetch.mock.calls[1]?.[1]?.body));
    expect(postCallBody).toEqual({
      text: '@CODCombatRecord Call of Duty CaptainPrice#1412123',
    });
  });

  it('cycles through clean official mention variants without ref suffix when X returns duplicate content 403', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { id: '9001', username: 'mw4player' } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail: 'You are not allowed to create a Tweet with duplicate content.',
          }),
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail: 'You are not allowed to create a Tweet with duplicate content.',
          }),
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'tweet-101' } }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'bot-reply-201',
                author_id: 'bot-1',
                referenced_tweets: [{ type: 'replied_to', id: 'tweet-101' }],
                attachments: { media_keys: ['m2'] },
              },
            ],
            includes: {
              users: [{ id: 'bot-1', username: 'CODCombatRecord' }],
              media: [
                {
                  media_key: 'm2',
                  type: 'photo',
                  url: 'https://pbs.twimg.com/media/card456.jpg',
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

    const provider = createProvider(mockFetch);
    const result = await provider.requestCombatRecord('Operator#5745488', {
      onTweetPosted: () => undefined,
      onWaitingForReply: () => undefined,
    });

    expect(result.replyTweetId).toBe('bot-reply-201');
    const attempt1Body = JSON.parse(String(mockFetch.mock.calls[1]?.[1]?.body));
    const attempt2Body = JSON.parse(String(mockFetch.mock.calls[2]?.[1]?.body));
    const attempt3Body = JSON.parse(String(mockFetch.mock.calls[3]?.[1]?.body));

    expect(attempt1Body.text).toBe('@CODCombatRecord Call of Duty Operator#5745488');
    expect(attempt2Body.text).toBe('Operator#5745488 @CODCombatRecord Call of Duty');
    expect(attempt3Body.text).toBe('@CODCombatRecord, Call of Duty, Operator#5745488');
    expect(attempt1Body.text).not.toContain('ref ');
    expect(attempt2Body.text).not.toContain('ref ');
    expect(attempt3Body.text).not.toContain('ref ');
  });

  it('throws XBotNoStatsError immediately when bot replies with text only and no media', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { id: '9001', username: 'mw4player' } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'tweet-102' } }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'bot-reply-202',
                author_id: 'bot-1',
                text: 'Could not find stats for Ghost#0000000',
                referenced_tweets: [{ type: 'replied_to', id: 'tweet-102' }],
              },
            ],
            includes: {
              users: [{ id: 'bot-1', username: 'CODCombatRecord' }],
            },
          }),
          { status: 200 },
        ),
      );

    const provider = createProvider(mockFetch);
    await expect(
      provider.requestCombatRecord('Ghost#0000000', {
        onTweetPosted: () => undefined,
        onWaitingForReply: () => undefined,
      }),
    ).rejects.toThrow(XBotNoStatsError);
  });

  it('throws XRateLimitError immediately on HTTP 429', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { id: '9001', username: 'mw4player' } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Too Many Requests' }), { status: 429 }),
      );

    const provider = createProvider(mockFetch);
    await expect(
      provider.requestCombatRecord('Ghost#1234', {
        onTweetPosted: () => undefined,
        onWaitingForReply: () => undefined,
      }),
    ).rejects.toThrow(XRateLimitError);
  });

  it('surfaces X API 403 detail in XAuthRequiredError without timing out', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { id: '9001', username: 'mw4player' } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'tweet-103' } }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail: 'When authenticating requests to the Twitter API v2 endpoints, you must use keys and tokens from a Twitter developer App that is attached to a Project.',
          }),
          { status: 403 },
        ),
      );

    const provider = createProvider(mockFetch);
    await expect(
      provider.requestCombatRecord('Ghost#1234', {
        onTweetPosted: () => undefined,
        onWaitingForReply: () => undefined,
      }),
    ).rejects.toThrow(
      new XAuthRequiredError(
        'Official X API rejected mentions read (HTTP 403): When authenticating requests to the Twitter API v2 endpoints, you must use keys and tokens from a Twitter developer App that is attached to a Project.',
      ),
    );
  });

  it('falls back to search/recent with bearerToken when mentions returns 403', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { id: '9001', username: 'mw4player' } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'tweet-104' } }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Mentions forbidden' }), { status: 403 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'bot-reply-204',
                author_id: 'bot-1',
                referenced_tweets: [{ type: 'replied_to', id: 'tweet-104' }],
                attachments: { media_keys: ['m4'] },
              },
            ],
            includes: {
              media: [
                {
                  media_key: 'm4',
                  type: 'photo',
                  url: 'https://pbs.twimg.com/media/search789.jpg',
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

    const provider = createProvider(mockFetch, 'my-bearer-token');
    const result = await provider.requestCombatRecord('Soap#5745488', {
      onTweetPosted: () => undefined,
      onWaitingForReply: () => undefined,
    });

    expect(result).toEqual({
      replyTweetId: 'bot-reply-204',
      imageUrl: 'https://pbs.twimg.com/media/search789.jpg',
    });

    const searchHeaders = mockFetch.mock.calls[3]?.[1]?.headers as Record<string, string>;
    expect(searchHeaders.Authorization).toBe('Bearer my-bearer-token');
  });

  it('checks search/recent in the same cycle when mentions returns 200 empty and resolves reply fast', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { id: '9001', username: 'mw4player' } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'tweet-105' } }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'bot-reply-205',
                author_id: 'bot-1',
                referenced_tweets: [{ type: 'replied_to', id: 'tweet-105' }],
                attachments: { media_keys: ['m5'] },
              },
            ],
            includes: {
              users: [{ id: 'bot-1', username: 'CODCombatRecord' }],
              media: [
                {
                  media_key: 'm5',
                  type: 'photo',
                  url: 'https://pbs.twimg.com/media/fastsearch.jpg',
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

    const provider = createProvider(mockFetch, 'app-bearer-token');
    const result = await provider.requestCombatRecord('Onatic#3733397', {
      onTweetPosted: () => undefined,
      onWaitingForReply: () => undefined,
    });

    expect(result).toEqual({
      replyTweetId: 'bot-reply-205',
      imageUrl: 'https://pbs.twimg.com/media/fastsearch.jpg',
    });
    expect(mockFetch).toHaveBeenCalledTimes(4);

    const searchUrl = new URL(String(mockFetch.mock.calls[3]?.[0]));
    expect(searchUrl.pathname).toBe('/2/tweets/search/recent');
    const queryParam = searchUrl.searchParams.get('query') ?? '';
    expect(queryParam).toContain('conversation_id:tweet-105');
    expect(queryParam).toContain('to:mw4player');
  });

  it('disables search/recent gracefully on 403 and resolves via mentions on subsequent poll', async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { id: '9001', username: 'mw4player' } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'tweet-106' } }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Recent search not authorized' }), {
          status: 403,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'bot-reply-206',
                author_id: 'bot-1',
                referenced_tweets: [{ type: 'replied_to', id: 'tweet-106' }],
                attachments: { media_keys: ['m6'] },
              },
            ],
            includes: {
              users: [{ id: 'bot-1', username: 'CODCombatRecord' }],
              media: [
                {
                  media_key: 'm6',
                  type: 'photo',
                  url: 'https://pbs.twimg.com/media/mentionsok.jpg',
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

    const provider = createProvider(mockFetch, 'app-bearer-token');
    const result = await provider.requestCombatRecord('iiode-#9775441', {
      onTweetPosted: () => undefined,
      onWaitingForReply: () => undefined,
    });

    expect(result).toEqual({
      replyTweetId: 'bot-reply-206',
      imageUrl: 'https://pbs.twimg.com/media/mentionsok.jpg',
    });
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });
});
