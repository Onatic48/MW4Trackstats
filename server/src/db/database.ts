import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const db = new DatabaseSync(databasePath);
  if (databasePath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS player_stats (
      normalized_id TEXT PRIMARY KEY,
      activision_id TEXT NOT NULL,
      stats_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_player_stats_updated_at
      ON player_stats (updated_at DESC);

    CREATE TABLE IF NOT EXISTS lookup_jobs (
      id TEXT PRIMARY KEY,
      normalized_id TEXT NOT NULL,
      activision_id TEXT NOT NULL,
      state TEXT NOT NULL,
      step TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      result_json TEXT,
      x_session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_lookup_jobs_active
      ON lookup_jobs (normalized_id, state);

    CREATE INDEX IF NOT EXISTS idx_lookup_jobs_created
      ON lookup_jobs (created_at ASC);

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      code_verifier TEXT NOT NULL,
      return_id TEXT,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS x_sessions (
      id TEXT PRIMARY KEY,
      x_user_id TEXT NOT NULL,
      x_username TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_tickets (
      ticket TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      return_id TEXT,
      oauth_state TEXT,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback_entries (
      id TEXT PRIMARY KEY,
      x_user_id TEXT NOT NULL,
      x_username TEXT NOT NULL,
      message TEXT NOT NULL,
      locale TEXT NOT NULL,
      synced_to_sheets INTEGER NOT NULL DEFAULT 0,
      sync_error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_entries_created
      ON feedback_entries (created_at DESC);
  `);

  // Safe migration for existing SQLite databases created before x_session_id existed
  const columns = db.prepare('PRAGMA table_info(lookup_jobs)').all() as Array<{ name: string }>;
  const hasSessionColumn = columns.some((col) => col.name === 'x_session_id');
  if (!hasSessionColumn) {
    db.exec('ALTER TABLE lookup_jobs ADD COLUMN x_session_id TEXT;');
  }

  // Safe migration for existing SQLite databases created before auth_tickets.oauth_state existed
  const ticketColumns = db
    .prepare('PRAGMA table_info(auth_tickets)')
    .all() as Array<{ name: string }>;
  const hasOAuthStateCol = ticketColumns.some((col) => col.name === 'oauth_state');
  if (!hasOAuthStateCol) {
    db.exec('ALTER TABLE auth_tickets ADD COLUMN oauth_state TEXT;');
  }

  return db;
}
