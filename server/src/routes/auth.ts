import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { AuthStatusResponse } from '@mw4trackstats/shared';
import type { AppConfig } from '../config.js';
import type { SessionRepository } from '../db/sessionRepository.js';
import {
  buildXAuthorizeUrl,
  exchangeOAuth2Code,
  fetchOAuth2UserProfile,
  generatePkcePair,
} from '../providers/x/xOAuth2.js';

export const SESSION_COOKIE_NAME = 'mw4_session';
export const OAUTH_STATE_COOKIE_NAME = 'mw4_oauth_state';

export function getAllowedOrigins(config: AppConfig): string[] {
  return config.clientOrigin
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function isCrossSitePostBlocked(
  req: Request,
  allowedOrigins: readonly string[],
): boolean {
  const originHeader = req.headers.origin;
  if (typeof originHeader === 'string' && originHeader.trim().length > 0) {
    const normalizedOrigin = originHeader.trim().replace(/\/+$/, '');
    if (allowedOrigins.length > 0 && !allowedOrigins.includes(normalizedOrigin)) {
      return true;
    }
  }

  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site') {
    return true;
  }

  const contentType = req.headers['content-type'];
  if (
    typeof contentType === 'string' &&
    contentType.trim().length > 0 &&
    !contentType.toLowerCase().includes('application/json')
  ) {
    return true;
  }

  return false;
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) {
    return out;
  }

  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const key = part.slice(0, eqIndex).trim();
    const rawValue = part.slice(eqIndex + 1).trim();
    if (!key) {
      continue;
    }
    try {
      out[key] = decodeURIComponent(rawValue);
    } catch {
      out[key] = rawValue;
    }
  }
  return out;
}

export function extractSessionIdFromRequest(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const value = cookies[SESSION_COOKIE_NAME]?.trim();
  return value ? value : null;
}

function getPrimaryClientOrigin(config: AppConfig): string {
  const first = config.clientOrigin
    .split(',')
    .map((o) => o.trim())
    .find(Boolean);
  return (first ?? 'http://localhost:5173').replace(/\/+$/, '');
}

function sanitizeReturnId(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 64 || /[\u0000-\u001f\u007f\r\n]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function buildSessionCookieHeader(sessionId: string, secure: boolean, maxAgeSeconds: number): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function buildOAuthStateCookieHeader(
  state: string,
  secure: boolean,
  maxAgeSeconds: number,
): string {
  const parts = [
    `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(state)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function createAuthRoutes(deps: {
  config: AppConfig;
  sessionRepo: SessionRepository;
  fetchImpl?: typeof fetch;
}): { apiRouter: Router; callbackHandler: (req: Request, res: Response) => Promise<void> } {
  const apiRouter = Router();
  const primaryOrigin = getPrimaryClientOrigin(deps.config);
  const allowedOrigins = getAllowedOrigins(deps.config);

  apiRouter.get('/auth/me', (req: Request, res: Response) => {
    const sessionId = extractSessionIdFromRequest(req);
    const session = sessionId ? deps.sessionRepo.findSessionById(sessionId) : null;

    const payload: AuthStatusResponse = {
      authenticated: Boolean(session),
      oauthConfigured: deps.config.oauth2Configured,
      user: session
        ? {
            xUserId: session.xUserId,
            username: session.xUsername,
          }
        : null,
    };

    res.json(payload);
  });

  apiRouter.get('/auth/x/login', (req: Request, res: Response) => {
    if (!deps.config.oauth2Configured) {
      res.status(503).json({
        error: {
          code: 'X_AUTH_REQUIRED',
          message: 'X OAuth 2.0 Client ID is not configured in .env',
        },
      });
      return;
    }

    const state = crypto.randomBytes(24).toString('base64url');
    const { codeVerifier, codeChallenge } = generatePkcePair();
    const returnId = sanitizeReturnId(req.query.returnId);

    deps.sessionRepo.saveOAuthState({
      state,
      codeVerifier,
      returnId,
    });

    const authorizeUrl = buildXAuthorizeUrl({
      clientId: deps.config.xOAuth2ClientId,
      redirectUri: deps.config.xOAuth2RedirectUri,
      state,
      codeChallenge,
    });

    res.setHeader(
      'Set-Cookie',
      buildOAuthStateCookieHeader(state, deps.config.sessionCookieSecure, 300),
    );
    res.redirect(302, authorizeUrl);
  });

  const callbackHandler = async (req: Request, res: Response): Promise<void> => {
    const errorParam = typeof req.query.error === 'string' ? req.query.error : null;
    if (errorParam) {
      res.redirect(302, `${primaryOrigin}/?authError=denied`);
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';

    if (!code || !state) {
      res.redirect(302, `${primaryOrigin}/?authError=invalid_state`);
      return;
    }

    const oauthState = deps.sessionRepo.consumeOAuthState(state);
    if (!oauthState) {
      res.redirect(302, `${primaryOrigin}/?authError=invalid_state`);
      return;
    }

    try {
      const tokens = await exchangeOAuth2Code({
        clientId: deps.config.xOAuth2ClientId,
        clientSecret: deps.config.xOAuth2ClientSecret,
        redirectUri: deps.config.xOAuth2RedirectUri,
        code,
        codeVerifier: oauthState.codeVerifier,
        fetchImpl: deps.fetchImpl,
      });

      const user = await fetchOAuth2UserProfile(tokens.accessToken, deps.fetchImpl);
      const session = deps.sessionRepo.createSession({
        xUserId: user.id,
        xUsername: user.username,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresInSeconds: tokens.expiresIn,
      });

      const ticket = deps.sessionRepo.saveAuthTicket({
        sessionId: session.id,
        returnId: oauthState.returnId,
        oauthState: oauthState.state,
      });

      res.redirect(
        302,
        `${primaryOrigin}/api/auth/x/complete?ticket=${encodeURIComponent(ticket)}`,
      );
    } catch (err) {
      console.error('[auth] OAuth 2.0 callback exchange failed:', err);
      res.redirect(302, `${primaryOrigin}/?authError=exchange_failed`);
    }
  };

  apiRouter.get('/auth/x/callback', (req: Request, res: Response) => {
    void callbackHandler(req, res);
  });

  apiRouter.get('/auth/x/complete', (req: Request, res: Response) => {
    const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : '';
    if (!ticket) {
      res.redirect(302, '/?authError=expired');
      return;
    }

    const ticketRecord = deps.sessionRepo.consumeAuthTicket(ticket);
    if (!ticketRecord) {
      res.redirect(302, '/?authError=expired');
      return;
    }

    const browserOAuthState =
      parseCookies(req.headers.cookie)[OAUTH_STATE_COOKIE_NAME]?.trim() ?? '';
    if (ticketRecord.oauthState && browserOAuthState !== ticketRecord.oauthState) {
      deps.sessionRepo.deleteSession(ticketRecord.sessionId);
      res.setHeader(
        'Set-Cookie',
        buildOAuthStateCookieHeader('', deps.config.sessionCookieSecure, 0),
      );
      res.redirect(302, '/?authError=invalid_state');
      return;
    }

    res.setHeader('Set-Cookie', [
      buildSessionCookieHeader(
        ticketRecord.sessionId,
        deps.config.sessionCookieSecure,
        30 * 24 * 60 * 60,
      ),
      buildOAuthStateCookieHeader('', deps.config.sessionCookieSecure, 0),
    ]);

    if (ticketRecord.returnId) {
      res.redirect(
        302,
        `/?id=${encodeURIComponent(ticketRecord.returnId)}&autolookup=1`,
      );
      return;
    }

    res.redirect(302, '/');
  });

  apiRouter.post('/auth/logout', (req: Request, res: Response) => {
    if (isCrossSitePostBlocked(req, allowedOrigins)) {
      res.status(403).json({
        error: {
          code: 'X_AUTH_REQUIRED',
          message: 'Cross-origin POST request rejected',
        },
      });
      return;
    }

    const sessionId = extractSessionIdFromRequest(req);
    if (sessionId) {
      deps.sessionRepo.deleteSession(sessionId);
    }

    res.setHeader(
      'Set-Cookie',
      buildSessionCookieHeader('', deps.config.sessionCookieSecure, 0),
    );
    res.json({ ok: true });
  });

  return { apiRouter, callbackHandler };
}
