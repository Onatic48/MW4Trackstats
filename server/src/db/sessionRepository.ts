import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface OAuthStateRecord {
  state: string;
  codeVerifier: string;
  returnId: string | null;
  expiresAt: string;
}

export interface XSessionRecord {
  id: string;
  xUserId: string;
  xUsername: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthTicketRecord {
  ticket: string;
  sessionId: string;
  returnId: string | null;
  oauthState: string | null;
  expiresAt: string;
}

export interface SessionRepository {
  saveOAuthState(params: {
    state: string;
    codeVerifier: string;
    returnId: string | null;
    ttlMs?: number;
  }): void;
  consumeOAuthState(state: string, now?: Date): OAuthStateRecord | null;
  createSession(params: {
    xUserId: string;
    xUsername: string;
    accessToken: string;
    refreshToken: string | null;
    expiresInSeconds: number;
  }): XSessionRecord;
  findSessionById(id: string, now?: Date): XSessionRecord | null;
  updateSessionTokens(
    id: string,
    params: {
      accessToken: string;
      refreshToken: string | null;
      expiresInSeconds: number;
    },
  ): XSessionRecord | null;
  deleteSession(id: string): void;
  saveAuthTicket(params: {
    sessionId: string;
    returnId: string | null;
    oauthState?: string | null;
    ttlMs?: number;
  }): string;
  consumeAuthTicket(ticket: string, now?: Date): AuthTicketRecord | null;
}

interface OAuthStateRow {
  state: string;
  code_verifier: string;
  return_id: string | null;
  expires_at: string;
}

interface XSessionRow {
  id: string;
  x_user_id: string;
  x_username: string;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string;
  created_at: string;
  updated_at: string;
}

interface AuthTicketRow {
  ticket: string;
  session_id: string;
  return_id: string | null;
  oauth_state: string | null;
  expires_at: string;
}

function mapSessionRow(row: XSessionRow | undefined): XSessionRecord | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    xUserId: row.x_user_id,
    xUsername: row.x_username,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenExpiresAt: row.token_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: DatabaseSync) {}

  saveOAuthState(params: {
    state: string;
    codeVerifier: string;
    returnId: string | null;
    ttlMs?: number;
  }): void {
    const ttlMs = params.ttlMs ?? 5 * 60_000;
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    this.db
      .prepare('DELETE FROM oauth_states WHERE expires_at <= ?')
      .run(new Date().toISOString());

    this.db
      .prepare(
        `INSERT INTO oauth_states (state, code_verifier, return_id, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(params.state, params.codeVerifier, params.returnId, expiresAt);
  }

  consumeOAuthState(state: string, now = new Date()): OAuthStateRecord | null {
    const row = this.db
      .prepare(
        `SELECT state, code_verifier, return_id, expires_at
         FROM oauth_states
         WHERE state = ?
         LIMIT 1`,
      )
      .get(state) as OAuthStateRow | undefined;

    if (!row) {
      return null;
    }

    this.db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);

    if (Date.parse(row.expires_at) <= now.getTime()) {
      return null;
    }

    return {
      state: row.state,
      codeVerifier: row.code_verifier,
      returnId: row.return_id,
      expiresAt: row.expires_at,
    };
  }

  createSession(params: {
    xUserId: string;
    xUsername: string;
    accessToken: string;
    refreshToken: string | null;
    expiresInSeconds: number;
  }): XSessionRecord {
    const id = crypto.randomUUID();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const minUpdatedAtIso = new Date(nowMs - SESSION_MAX_AGE_MS).toISOString();
    const tokenExpiresAt = new Date(
      nowMs + Math.max(60, params.expiresInSeconds) * 1000,
    ).toISOString();

    this.db
      .prepare(
        `DELETE FROM x_sessions
         WHERE updated_at <= ? OR (refresh_token IS NULL AND token_expires_at <= ?)`,
      )
      .run(minUpdatedAtIso, nowIso);

    this.db
      .prepare(
        `INSERT INTO x_sessions (
          id, x_user_id, x_username, access_token, refresh_token, token_expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.xUserId,
        params.xUsername,
        params.accessToken,
        params.refreshToken,
        tokenExpiresAt,
        nowIso,
        nowIso,
      );

    const created = this.findSessionById(id);
    if (!created) {
      throw new Error('Failed to load newly created X session');
    }
    return created;
  }

  findSessionById(id: string, now = new Date()): XSessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, x_user_id, x_username, access_token, refresh_token, token_expires_at, created_at, updated_at
         FROM x_sessions
         WHERE id = ?
         LIMIT 1`,
      )
      .get(id) as XSessionRow | undefined;

    if (!row) {
      return null;
    }

    const nowMs = now.getTime();
    const updatedAtMs = Date.parse(row.updated_at);
    const tokenExpiresAtMs = Date.parse(row.token_expires_at);

    const exceededMaxAge =
      Number.isFinite(updatedAtMs) && updatedAtMs + SESSION_MAX_AGE_MS <= nowMs;
    const expiredWithoutRefresh =
      !row.refresh_token && Number.isFinite(tokenExpiresAtMs) && tokenExpiresAtMs <= nowMs;

    if (exceededMaxAge || expiredWithoutRefresh) {
      this.deleteSession(id);
      return null;
    }

    return mapSessionRow(row);
  }

  updateSessionTokens(
    id: string,
    params: {
      accessToken: string;
      refreshToken: string | null;
      expiresInSeconds: number;
    },
  ): XSessionRecord | null {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const tokenExpiresAt = new Date(
      nowMs + Math.max(60, params.expiresInSeconds) * 1000,
    ).toISOString();

    this.db
      .prepare(
        `UPDATE x_sessions
         SET access_token = ?,
             refresh_token = COALESCE(?, refresh_token),
             token_expires_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(params.accessToken, params.refreshToken, tokenExpiresAt, nowIso, id);

    return this.findSessionById(id);
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM x_sessions WHERE id = ?').run(id);
  }

  saveAuthTicket(params: {
    sessionId: string;
    returnId: string | null;
    oauthState?: string | null;
    ttlMs?: number;
  }): string {
    const ticket = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + (params.ttlMs ?? 60_000)).toISOString();

    this.db
      .prepare('DELETE FROM auth_tickets WHERE expires_at <= ?')
      .run(new Date().toISOString());

    this.db
      .prepare(
        `INSERT INTO auth_tickets (ticket, session_id, return_id, oauth_state, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(ticket, params.sessionId, params.returnId, params.oauthState ?? null, expiresAt);

    return ticket;
  }

  consumeAuthTicket(ticket: string, now = new Date()): AuthTicketRecord | null {
    const row = this.db
      .prepare(
        `SELECT ticket, session_id, return_id, oauth_state, expires_at
         FROM auth_tickets
         WHERE ticket = ?
         LIMIT 1`,
      )
      .get(ticket) as AuthTicketRow | undefined;

    if (!row) {
      return null;
    }

    this.db.prepare('DELETE FROM auth_tickets WHERE ticket = ?').run(ticket);

    if (Date.parse(row.expires_at) <= now.getTime()) {
      return null;
    }

    return {
      ticket: row.ticket,
      sessionId: row.session_id,
      returnId: row.return_id,
      oauthState: row.oauth_state ?? null,
      expiresAt: row.expires_at,
    };
  }
}
