import type { FeedbackRecord } from '../../db/feedbackRepository.js';

const ALLOWED_APPS_SCRIPT_HOSTS = new Set([
  'script.google.com',
  'script.googleusercontent.com',
]);

const WEBHOOK_TIMEOUT_MS = 10_000;

export function sanitizeSpreadsheetCell(value: string): string {
  const cleaned = value.replace(/\u0000/g, '').trim();
  if (/^[=+\-@\t\r]/.test(cleaned)) {
    return `'${cleaned}`;
  }
  return cleaned;
}

export function validateGoogleAppsScriptUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid Google Sheets webhook URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Google Sheets webhook must use HTTPS (got ${parsed.protocol})`);
  }

  if (parsed.username || parsed.password) {
    throw new Error('Google Sheets webhook URL must not contain credentials');
  }

  if (parsed.port && parsed.port !== '443') {
    throw new Error(`Google Sheets webhook URL must use standard HTTPS port`);
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_APPS_SCRIPT_HOSTS.has(host)) {
    throw new Error(`Blocked untrusted Google Sheets webhook host: ${host}`);
  }

  return parsed;
}

export async function appendFeedbackToGoogleSheet(params: {
  webhookUrl: string;
  webhookSecret: string;
  entry: FeedbackRecord;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const targetUrl = validateGoogleAppsScriptUrl(params.webhookUrl);
  const fetchFn = params.fetchImpl ?? fetch;

  const response = await fetchFn(targetUrl.toString(), {
    method: 'POST',
    redirect: 'follow',
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      secret: params.webhookSecret,
      id: params.entry.id,
      createdAt: params.entry.createdAt,
      xUserId: params.entry.xUserId,
      xUsername: sanitizeSpreadsheetCell(`@${params.entry.xUsername}`),
      message: sanitizeSpreadsheetCell(params.entry.message),
      locale: params.entry.locale,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google Sheets webhook HTTP ${response.status}`);
  }

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  const bodyText = await response.text();
  if (!contentType.includes('application/json')) {
    throw new Error('Google Sheets webhook returned non-JSON response (check Apps Script "Who has access: Anyone")');
  }

  let parsedBody: { ok?: boolean; error?: string };
  try {
    parsedBody = JSON.parse(bodyText) as { ok?: boolean; error?: string };
  } catch {
    throw new Error('Google Sheets webhook returned invalid JSON');
  }

  if (!parsedBody.ok) {
    throw new Error(parsedBody.error || 'Google Sheets webhook rejected payload');
  }
}
