/**
 * Google Apps Script Web App webhook for MW4Trackstats feedback.
 *
 * Setup:
 * 1. Create a Google Sheet and open Extensions -> Apps Script.
 * 2. Paste this script and replace WEBHOOK_SECRET with a long random string
 *    (matching GOOGLE_SHEETS_WEBHOOK_SECRET in your server .env).
 * 3. Click Deploy -> New deployment -> Web app:
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 4. Copy the Web app URL (https://script.google.com/macros/s/.../exec)
 *    into GOOGLE_SHEETS_WEBHOOK_URL in your server .env.
 */

const WEBHOOK_SECRET = 'REPLACE_WITH_YOUR_SECRET';
const HEADERS = ['Timestamp (UTC)', 'X Username', 'X User ID', 'Message', 'Locale', 'Feedback ID'];

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: 'Missing request body' });
    }

    const data = JSON.parse(e.postData.contents);
    if (!WEBHOOK_SECRET || WEBHOOK_SECRET === 'REPLACE_WITH_YOUR_SECRET') {
      return jsonResponse({ ok: false, error: 'Webhook secret not configured in Apps Script' });
    }

    if (data.secret !== WEBHOOK_SECRET) {
      return jsonResponse({ ok: false, error: 'Unauthorized secret' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheets()[0];

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([
      String(data.createdAt || new Date().toISOString()),
      String(data.xUsername || ''),
      String(data.xUserId || ''),
      String(data.message || ''),
      String(data.locale || 'en'),
      String(data.id || ''),
    ]);

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: err && err.message ? err.message : 'Unexpected script error',
    });
  }
}
