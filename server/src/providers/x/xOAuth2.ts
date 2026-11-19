import crypto from 'node:crypto';

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export interface OAuth2TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string;
}

export interface OAuth2UserProfile {
  id: string;
  username: string;
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function buildXAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL('https://x.com/i/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', 'tweet.read tweet.write users.read offline.access');
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function buildTokenAuthHeader(clientId: string, clientSecret: string): string | undefined {
  if (!clientSecret) {
    return undefined;
  }
  const encoded = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  return `Basic ${encoded}`;
}

export async function exchangeOAuth2Code(params: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<OAuth2TokenSet> {
  const fetchFn = params.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const basicAuth = buildTokenAuthHeader(params.clientId, params.clientSecret);
  if (basicAuth) {
    headers.Authorization = basicAuth;
  } else {
    body.set('client_id', params.clientId);
  }

  const resp = await fetchFn('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers,
    body: body.toString(),
  });

  const rawText = await resp.text();
  if (!resp.ok) {
    throw new Error(`X OAuth2 token exchange failed (HTTP ${resp.status}): ${rawText}`);
  }

  const parsed = JSON.parse(rawText) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (!parsed.access_token) {
    throw new Error('X OAuth2 token response missing access_token');
  }

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? null,
    expiresIn: typeof parsed.expires_in === 'number' ? parsed.expires_in : 7200,
    scope: parsed.scope ?? '',
  };
}

export async function refreshOAuth2AccessToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<OAuth2TokenSet> {
  const fetchFn = params.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const basicAuth = buildTokenAuthHeader(params.clientId, params.clientSecret);
  if (basicAuth) {
    headers.Authorization = basicAuth;
  } else {
    body.set('client_id', params.clientId);
  }

  const resp = await fetchFn('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers,
    body: body.toString(),
  });

  const rawText = await resp.text();
  if (!resp.ok) {
    throw new Error(`X OAuth2 token refresh failed (HTTP ${resp.status}): ${rawText}`);
  }

  const parsed = JSON.parse(rawText) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (!parsed.access_token) {
    throw new Error('X OAuth2 refresh response missing access_token');
  }

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? params.refreshToken,
    expiresIn: typeof parsed.expires_in === 'number' ? parsed.expires_in : 7200,
    scope: parsed.scope ?? '',
  };
}

export async function fetchOAuth2UserProfile(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuth2UserProfile> {
  const resp = await fetchImpl('https://api.x.com/2/users/me', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const rawText = await resp.text();
  if (!resp.ok) {
    throw new Error(`X OAuth2 GET /2/users/me failed (HTTP ${resp.status}): ${rawText}`);
  }

  const parsed = JSON.parse(rawText) as {
    data?: { id?: string; username?: string };
  };
  const id = parsed.data?.id;
  const username = parsed.data?.username;
  if (!id || !username) {
    throw new Error('X OAuth2 GET /2/users/me returned incomplete user data');
  }

  return { id, username };
}
