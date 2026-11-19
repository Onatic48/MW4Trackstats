import { type CombatRecordStats } from '@mw4trackstats/shared';
import { validateTrustedImageUrl } from '../providers/x/mediaDownload.js';

const LOCAL_IMAGE_PATH_REGEX = /^\/api\/images\/[a-f0-9-]+\.(png|jpg|jpeg|webp)$/i;
const integerFormatter = new Intl.NumberFormat('en-US');

export function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatInt(value: number): string {
  return integerFormatter.format(Math.round(value));
}

function formatRatio(value: number): string {
  return value.toFixed(2);
}

function formatPercent(value: number): string {
  const clean = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return `${clean}%`;
}

export function formatStatsEmbedDescription(stats: CombatRecordStats): string {
  const lines: string[] = [];
  const { multiplayer, dmz, battleRoyale, resurgence } = stats.modes;

  if (multiplayer.timePlayed !== null || multiplayer.kills !== null) {
    const parts: string[] = [];
    if (multiplayer.timePlayed !== null) parts.push(multiplayer.timePlayed);
    if (multiplayer.kills !== null) parts.push(`${formatInt(multiplayer.kills)} Kills`);
    if (multiplayer.kdRatio !== null) parts.push(`${formatRatio(multiplayer.kdRatio)} K/D`);
    if (multiplayer.wins !== null) parts.push(`${formatInt(multiplayer.wins)} Wins`);
    if (multiplayer.accuracyPercent !== null && multiplayer.accuracyPercent !== undefined) {
      parts.push(`${formatPercent(multiplayer.accuracyPercent)} Acc`);
    }
    if (parts.length > 0) {
      lines.push(`MW4 Multiplayer: ${parts.join(' · ')}`);
    }
  }

  if (dmz.timePlayed !== null || dmz.hostileEliminations !== null) {
    const parts: string[] = [];
    if (dmz.timePlayed !== null) parts.push(dmz.timePlayed);
    if (dmz.playerEliminations !== null) {
      parts.push(`${formatInt(dmz.playerEliminations)} Player Elims`);
    }
    if (dmz.hostileEliminations !== null) {
      parts.push(`${formatInt(dmz.hostileEliminations)} Hostile Elims`);
    }
    if (dmz.successfulExfils !== null) {
      parts.push(`${formatInt(dmz.successfulExfils)} Exfils`);
    }
    if (parts.length > 0) {
      lines.push(`DMZ: ${parts.join(' · ')}`);
    }
  }

  if (battleRoyale.timePlayed !== null || battleRoyale.kills !== null) {
    const parts: string[] = [];
    if (battleRoyale.timePlayed !== null) parts.push(battleRoyale.timePlayed);
    if (battleRoyale.kills !== null) parts.push(`${formatInt(battleRoyale.kills)} Kills`);
    if (battleRoyale.kdRatio !== null) parts.push(`${formatRatio(battleRoyale.kdRatio)} K/D`);
    if (battleRoyale.wins !== null) parts.push(`${formatInt(battleRoyale.wins)} Wins`);
    if (parts.length > 0) {
      lines.push(`Battle Royale: ${parts.join(' · ')}`);
    }
  }

  if (resurgence.timePlayed !== null || resurgence.kills !== null) {
    const parts: string[] = [];
    if (resurgence.timePlayed !== null) parts.push(resurgence.timePlayed);
    if (resurgence.kills !== null) parts.push(`${formatInt(resurgence.kills)} Kills`);
    if (resurgence.kdRatio !== null) parts.push(`${formatRatio(resurgence.kdRatio)} K/D`);
    if (resurgence.wins !== null) parts.push(`${formatInt(resurgence.wins)} Wins`);
    if (parts.length > 0) {
      lines.push(`Resurgence: ${parts.join(' · ')}`);
    }
  }

  if (lines.length === 0) {
    return `Call of Duty ${stats.season} combat record for ${stats.activisionId} via @${stats.sourceBotHandle}.`;
  }

  return lines.join('\n');
}

export function resolveSafeEmbedImageUrl(
  stats: CombatRecordStats,
  publicOrigin: string,
): string | null {
  if (stats.imageUrl) {
    try {
      return validateTrustedImageUrl(stats.imageUrl).toString();
    } catch {
      // Untrusted external image URL rejected; fall back to validated local path if present
    }
  }

  if (stats.localImagePath && LOCAL_IMAGE_PATH_REGEX.test(stats.localImagePath)) {
    const base = publicOrigin.replace(/\/+$/, '');
    return `${base}${stats.localImagePath}`;
  }

  return null;
}

export function buildOEmbedPayload(params: {
  stats: CombatRecordStats | null;
  activisionId: string | null;
  publicOrigin: string;
}): {
  version: string;
  type: string;
  provider_name: string;
  provider_url: string;
  author_name: string;
  author_url: string;
  title: string;
} {
  const normalizedOrigin = params.publicOrigin.replace(/\/+$/, '');
  const { stats, activisionId } = params;

  const authorUrl =
    stats && stats.replyTweetId && /^\d+$/.test(stats.replyTweetId)
      ? `https://x.com/${stats.sourceBotHandle}/status/${stats.replyTweetId}`
      : normalizedOrigin;

  const title = stats
    ? `${stats.activisionId} — ${stats.season} Combat Record`
    : activisionId
      ? `${activisionId} — MW4Trackstats`
      : 'MW4Trackstats — Call of Duty Combat Record';

  return {
    version: '1.0',
    type: 'link',
    provider_name: 'MW4Trackstats',
    provider_url: normalizedOrigin,
    author_name: stats
      ? `${stats.season} · @${stats.sourceBotHandle}`
      : 'Call of Duty Combat Record',
    author_url: authorUrl,
    title,
  };
}

export function renderIndexHtmlWithEmbedMeta(params: {
  templateHtml: string;
  stats: CombatRecordStats | null;
  queriedId: string | null;
  publicOrigin: string;
}): string {
  const normalizedOrigin = params.publicOrigin.replace(/\/+$/, '');
  const activeId = params.stats?.activisionId ?? params.queriedId;

  const title = params.stats
    ? `${params.stats.activisionId} — ${params.stats.season} Combat Record | MW4Trackstats`
    : params.queriedId
      ? `${params.queriedId} — MW4Trackstats`
      : 'MW4Trackstats — Call of Duty Combat Record';

  const ogTitle = params.stats
    ? `${params.stats.activisionId} — ${params.stats.season} Combat Record`
    : params.queriedId
      ? `${params.queriedId} — Combat Record Lookup`
      : 'MW4Trackstats — Call of Duty Combat Record';

  const description = params.stats
    ? formatStatsEmbedDescription(params.stats)
    : params.queriedId
      ? `Look up Call of Duty Season 01 combat record stats for ${params.queriedId} via @CODCombatRecord.`
      : 'Retrieve Call of Duty Season 01 combat record stats for MW4 Multiplayer, DMZ, Battle Royale, and Resurgence via @CODCombatRecord.';

  const canonicalUrl = activeId
    ? `${normalizedOrigin}/?id=${encodeURIComponent(activeId)}`
    : `${normalizedOrigin}/`;

  const oembedUrl = activeId
    ? `${normalizedOrigin}/api/oembed?id=${encodeURIComponent(activeId)}`
    : `${normalizedOrigin}/api/oembed`;

  const imageUrl = params.stats
    ? resolveSafeEmbedImageUrl(params.stats, normalizedOrigin)
    : null;

  const tags = [
    '<meta name="theme-color" content="#EAB308" />',
    `<meta name="description" content="${escapeHtmlAttr(description)}" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="MW4Trackstats" />',
    `<meta property="og:url" content="${escapeHtmlAttr(canonicalUrl)}" />`,
    `<meta property="og:title" content="${escapeHtmlAttr(ogTitle)}" />`,
    `<meta property="og:description" content="${escapeHtmlAttr(description)}" />`,
    ...(imageUrl
      ? [
          `<meta property="og:image" content="${escapeHtmlAttr(imageUrl)}" />`,
          '<meta name="twitter:card" content="summary_large_image" />',
          `<meta name="twitter:image" content="${escapeHtmlAttr(imageUrl)}" />`,
        ]
      : ['<meta name="twitter:card" content="summary" />']),
    `<meta name="twitter:title" content="${escapeHtmlAttr(ogTitle)}" />`,
    `<meta name="twitter:description" content="${escapeHtmlAttr(description)}" />`,
    `<link rel="alternate" type="application/json+oembed" href="${escapeHtmlAttr(oembedUrl)}" title="${escapeHtmlAttr(ogTitle)}" />`,
  ];

  const metaBlock = `    ${tags.join('\n    ')}`;

  let html = params.templateHtml.replace(
    /<title>[\s\S]*?<\/title>/i,
    () => `<title>${escapeHtmlAttr(title)}</title>`,
  );

  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, () => `${metaBlock}\n  </head>`);
  } else {
    html = `${metaBlock}\n${html}`;
  }

  return html;
}
