import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface FeedbackRecord {
  id: string;
  xUserId: string;
  xUsername: string;
  message: string;
  locale: 'en' | 'tr';
  syncedToSheets: boolean;
  syncError: string | null;
  createdAt: string;
}

export interface FeedbackRepository {
  create(params: {
    xUserId: string;
    xUsername: string;
    message: string;
    locale: 'en' | 'tr';
  }): FeedbackRecord;
  markSynced(id: string, synced: boolean, syncError?: string | null): FeedbackRecord | null;
  findById(id: string): FeedbackRecord | null;
}

interface FeedbackRow {
  id: string;
  x_user_id: string;
  x_username: string;
  message: string;
  locale: string;
  synced_to_sheets: number;
  sync_error: string | null;
  created_at: string;
}

function parseRow(row: FeedbackRow | undefined): FeedbackRecord | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    xUserId: row.x_user_id,
    xUsername: row.x_username,
    message: row.message,
    locale: row.locale === 'tr' ? 'tr' : 'en',
    syncedToSheets: row.synced_to_sheets === 1,
    syncError: row.sync_error ?? null,
    createdAt: row.created_at,
  };
}

export class SqliteFeedbackRepository implements FeedbackRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(params: {
    xUserId: string;
    xUsername: string;
    message: string;
    locale: 'en' | 'tr';
  }): FeedbackRecord {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO feedback_entries (
          id, x_user_id, x_username, message, locale, synced_to_sheets, sync_error, created_at
        ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?)`,
      )
      .run(id, params.xUserId, params.xUsername, params.message, params.locale, createdAt);

    return {
      id,
      xUserId: params.xUserId,
      xUsername: params.xUsername,
      message: params.message,
      locale: params.locale,
      syncedToSheets: false,
      syncError: null,
      createdAt,
    };
  }

  markSynced(id: string, synced: boolean, syncError: string | null = null): FeedbackRecord | null {
    this.db
      .prepare(
        `UPDATE feedback_entries
         SET synced_to_sheets = ?, sync_error = ?
         WHERE id = ?`,
      )
      .run(synced ? 1 : 0, syncError, id);
    return this.findById(id);
  }

  findById(id: string): FeedbackRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, x_user_id, x_username, message, locale, synced_to_sheets, sync_error, created_at
         FROM feedback_entries
         WHERE id = ?
         LIMIT 1`,
      )
      .get(id) as FeedbackRow | undefined;

    return parseRow(row);
  }
}
