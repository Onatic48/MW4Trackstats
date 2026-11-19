import sharp, { type Metadata } from 'sharp';
import {
  COD_CARD_GLYPHS,
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
  type GlyphPrototype,
} from './codCardGlyphs.js';
import { normalizeParsedCard, type ParsedCardResult } from './types.js';

type FieldKind = 'duration' | 'integer' | 'decimal' | 'percent';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface GlyphSample {
  aspect: number;
  relH: number;
  vec: Float32Array;
}

const MIN_GLYPH_SCORE = 0.62;
const MIN_GLYPH_MARGIN = 0.02;

const WHITELISTS: Record<FieldKind, readonly string[]> = {
  duration: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '-', 'D', 'H', 'M'],
  integer: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '-'],
  decimal: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '-'],
  percent: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '-', '%L', '%R', '%'],
};

const FIELD_PATTERNS: Record<FieldKind, RegExp> = {
  duration: /^(--|\d+D \d+H|\d+H \d+M|\d+[DHM])$/,
  integer: /^(--|\d+)$/,
  decimal: /^(--|\d+(\.\d{1,2})?)$/,
  percent: /^(--|\d+(\.\d{1,2})?%)$/,
};

const EMPTY_DMZ_RAW = {
  timePlayed: null,
  playerEliminations: null,
  hostileEliminations: null,
  containersOpened: null,
  successfulExfils: null,
};

const EMPTY_WARZONE_RAW = {
  timePlayed: null,
  kills: null,
  kdRatio: null,
  highestKillsPerGame: null,
  wins: null,
};

function measureRegionColors(
  data: Uint8Array,
  imgWidth: number,
  channels: number,
  rect: Rect,
): { whitePct: number; goldPct: number } {
  let white = 0;
  let gold = 0;
  const total = rect.width * rect.height;

  for (let y = rect.top; y < rect.top + rect.height; y += 1) {
    for (let x = rect.left; x < rect.left + rect.width; x += 1) {
      const idx = (y * imgWidth + x) * channels;
      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;
      const minC = Math.min(r, g, b);
      const maxC = Math.max(r, g, b);
      if (minC >= 185 && maxC - minC <= 50) {
        white += 1;
      }
      if (r >= 180 && g >= 110 && b <= 90 && r - b >= 100) {
        gold += 1;
      }
    }
  }

  return {
    whitePct: (white / total) * 100,
    goldPct: (gold / total) * 100,
  };
}

function extractBoxGlyphs(
  data: Uint8Array,
  imgWidth: number,
  channels: number,
  rect: Rect,
): GlyphSample[] {
  const { left, top, width, height } = rect;
  const lum = new Float32Array(width * height);
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = ((top + y) * imgWidth + (left + x)) * channels;
      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;
      const minC = Math.min(r, g, b);
      const maxC = Math.max(r, g, b);
      const sat = maxC - minC;
      const wh = Math.max(0, Math.min(1, (minC - sat * 0.85 - 150) / 85));
      lum[y * width + x] = wh;
      if (minC >= 185 && sat <= 50) {
        mask[y * width + x] = 1;
      }
    }
  }

  const colSegs: Array<[number, number]> = [];
  let inSeg = false;
  let segStart = 0;
  for (let x = 0; x < width; x += 1) {
    let colSum = 0;
    for (let y = 0; y < height; y += 1) {
      colSum += mask[y * width + x] ?? 0;
    }
    if (colSum >= 2 && !inSeg) {
      inSeg = true;
      segStart = x;
    } else if (colSum < 2 && inSeg) {
      inSeg = false;
      if (x - segStart >= 2) {
        colSegs.push([segStart, x - 1]);
      }
    }
  }
  if (inSeg && width - segStart >= 2) {
    colSegs.push([segStart, width - 1]);
  }

  const glyphs: GlyphSample[] = [];
  for (const [x0, x1] of colSegs) {
    let y0 = height;
    let y1 = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (mask[y * width + x]) {
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (y1 < y0) {
      continue;
    }

    const sw = x1 - x0 + 1;
    const sh = y1 - y0 + 1;
    const vec = new Float32Array(GLYPH_WIDTH * GLYPH_HEIGHT);

    for (let gy = 0; gy < GLYPH_HEIGHT; gy += 1) {
      const sy = y0 + ((gy + 0.5) * sh) / GLYPH_HEIGHT;
      const iy = Math.min(y1, Math.max(y0, Math.floor(sy)));
      for (let gx = 0; gx < GLYPH_WIDTH; gx += 1) {
        const sx = x0 + ((gx + 0.5) * sw) / GLYPH_WIDTH;
        const ix = Math.min(x1, Math.max(x0, Math.floor(sx)));
        vec[gy * GLYPH_WIDTH + gx] = (lum[iy * width + ix] ?? 0) * 2 - 1;
      }
    }

    glyphs.push({
      aspect: sw / sh,
      relH: sh / height,
      vec,
    });
  }

  return glyphs;
}

function scorePrototype(sample: GlyphSample, proto: GlyphPrototype): number {
  let dot = 0;
  let normSample = 0;
  let normProto = 0;

  for (let i = 0; i < sample.vec.length; i += 1) {
    const a = sample.vec[i] ?? 0;
    const b = (proto.vec[i] ?? 0) / 100;
    dot += a * b;
    normSample += a * a;
    normProto += b * b;
  }

  const cosine = dot / (Math.sqrt(normSample * normProto) || 1);
  return (
    cosine -
    0.25 * Math.abs(sample.aspect - proto.aspect) -
    0.5 * Math.abs(sample.relH - proto.relH)
  );
}

interface BoxDecodeOutcome {
  ok: boolean;
  value: string;
  minScore: number;
  minMargin: number;
  reason?: string;
}

function decodeBox(
  data: Uint8Array,
  imgWidth: number,
  channels: number,
  rect: Rect,
  kind: FieldKind,
  label: string,
): BoxDecodeOutcome {
  const glyphs = extractBoxGlyphs(data, imgWidth, channels, rect);
  if (glyphs.length === 0) {
    return { ok: false, value: '', minScore: 0, minMargin: 0, reason: `${label}:empty` };
  }

  const allowed = WHITELISTS[kind];
  let minScore = Number.POSITIVE_INFINITY;
  let minMargin = Number.POSITIVE_INFINITY;
  const tokens: string[] = [];

  for (let idx = 0; idx < glyphs.length; idx += 1) {
    const glyph = glyphs[idx]!;
    let bestSym = '';
    let bestScore = Number.NEGATIVE_INFINITY;
    let secondScore = Number.NEGATIVE_INFINITY;

    for (const sym of allowed) {
      const proto = COD_CARD_GLYPHS[sym];
      if (!proto) continue;
      const sc = scorePrototype(glyph, proto);
      if (sc > bestScore) {
        secondScore = bestScore;
        bestScore = sc;
        bestSym = sym;
      } else if (sc > secondScore) {
        secondScore = sc;
      }
    }

    const margin = bestScore - secondScore;
    if (bestScore < MIN_GLYPH_SCORE || margin < MIN_GLYPH_MARGIN) {
      return {
        ok: false,
        value: '',
        minScore: bestScore,
        minMargin: margin,
        reason: `${label}[${idx}]:low_conf(${bestSym}=${bestScore.toFixed(2)},m=${margin.toFixed(3)})`,
      };
    }

    if (bestScore < minScore) minScore = bestScore;
    if (margin < minMargin) minMargin = margin;
    tokens.push(bestSym);
  }

  let formatted = tokens.join('');
  if (kind === 'duration') {
    formatted = formatted.replace(/([DH])(\d)/g, '$1 $2');
  } else if (kind === 'percent') {
    formatted = formatted.replace(/%L%R/g, '%');
  }

  if (!FIELD_PATTERNS[kind].test(formatted)) {
    return {
      ok: false,
      value: formatted,
      minScore,
      minMargin,
      reason: `${label}:pattern_mismatch(${JSON.stringify(formatted)})`,
    };
  }

  return { ok: true, value: formatted, minScore, minMargin };
}

interface BoxSpec {
  key: string;
  rect: Rect;
  kind: FieldKind;
}

function decodeBoxMap(
  data: Uint8Array,
  imgWidth: number,
  channels: number,
  specs: readonly BoxSpec[],
): { ok: true; values: Record<string, string>; minScore: number; minMargin: number } | { ok: false; reason: string } {
  const values: Record<string, string> = {};
  let minScore = Number.POSITIVE_INFINITY;
  let minMargin = Number.POSITIVE_INFINITY;

  for (const spec of specs) {
    const decoded = decodeBox(data, imgWidth, channels, spec.rect, spec.kind, spec.key);
    if (!decoded.ok) {
      return { ok: false, reason: decoded.reason ?? spec.key };
    }
    values[spec.key] = decoded.value;
    if (decoded.minScore < minScore) minScore = decoded.minScore;
    if (decoded.minMargin < minMargin) minMargin = decoded.minMargin;
  }

  return { ok: true, values, minScore, minMargin };
}

function makePortraitMpSpecs(): BoxSpec[] {
  return [
    { key: 'mp.timePlayed', rect: { left: 64, top: 256, width: 276, height: 68 }, kind: 'duration' },
    { key: 'mp.kills', rect: { left: 64, top: 396, width: 276, height: 68 }, kind: 'integer' },
    { key: 'mp.kdRatio', rect: { left: 64, top: 536, width: 276, height: 68 }, kind: 'decimal' },
    { key: 'mp.highestStreak', rect: { left: 64, top: 676, width: 276, height: 68 }, kind: 'integer' },
    { key: 'mp.wins', rect: { left: 562, top: 256, width: 276, height: 68 }, kind: 'integer' },
    { key: 'mp.gamesPlayed', rect: { left: 562, top: 396, width: 276, height: 68 }, kind: 'integer' },
    { key: 'mp.winLossRatio', rect: { left: 562, top: 536, width: 276, height: 68 }, kind: 'decimal' },
    { key: 'mp.accuracyPercent', rect: { left: 562, top: 676, width: 276, height: 68 }, kind: 'percent' },
  ];
}

function makeLandscape4ModeSpecs(): BoxSpec[] {
  const rows = [194, 277, 360, 443, 526] as const;
  const col = (prefix: string, left: number, specs: Array<[string, FieldKind]>): BoxSpec[] =>
    specs.map(([field, kind], i) => ({
      key: `${prefix}.${field}`,
      rect: { left, top: rows[i]!, width: 174, height: 42 },
      kind,
    }));

  return [
    ...col('mp', 36, [
      ['timePlayed', 'duration'],
      ['kills', 'integer'],
      ['kdRatio', 'decimal'],
      ['highestStreak', 'integer'],
      ['wins', 'integer'],
    ]),
    ...col('dmz', 232, [
      ['timePlayed', 'duration'],
      ['playerEliminations', 'integer'],
      ['hostileEliminations', 'integer'],
      ['containersOpened', 'integer'],
      ['successfulExfils', 'integer'],
    ]),
    ...col('br', 784, [
      ['timePlayed', 'duration'],
      ['kills', 'integer'],
      ['kdRatio', 'decimal'],
      ['highestKillsPerGame', 'integer'],
      ['wins', 'integer'],
    ]),
    ...col('res', 986, [
      ['timePlayed', 'duration'],
      ['kills', 'integer'],
      ['kdRatio', 'decimal'],
      ['highestKillsPerGame', 'integer'],
      ['wins', 'integer'],
    ]),
  ];
}

function makeLandscape2ModeSpecs(): BoxSpec[] {
  const rows = [192, 276, 359, 443] as const;
  return [
    { key: 'mp.timePlayed', rect: { left: 44, top: rows[0], width: 174, height: 44 }, kind: 'duration' },
    { key: 'mp.kills', rect: { left: 44, top: rows[1], width: 174, height: 44 }, kind: 'integer' },
    { key: 'mp.kdRatio', rect: { left: 44, top: rows[2], width: 174, height: 44 }, kind: 'decimal' },
    { key: 'mp.highestStreak', rect: { left: 44, top: rows[3], width: 174, height: 44 }, kind: 'integer' },
    { key: 'mp.wins', rect: { left: 238, top: rows[0], width: 174, height: 44 }, kind: 'integer' },
    { key: 'mp.gamesPlayed', rect: { left: 238, top: rows[1], width: 174, height: 44 }, kind: 'integer' },
    { key: 'mp.winLossRatio', rect: { left: 238, top: rows[2], width: 174, height: 44 }, kind: 'decimal' },
    { key: 'mp.accuracyPercent', rect: { left: 238, top: rows[3], width: 174, height: 44 }, kind: 'percent' },
    { key: 'dmz.timePlayed', rect: { left: 786, top: rows[0], width: 174, height: 44 }, kind: 'duration' },
    { key: 'dmz.playerEliminations', rect: { left: 786, top: rows[1], width: 174, height: 44 }, kind: 'integer' },
    { key: 'dmz.hostileEliminations', rect: { left: 786, top: rows[2], width: 174, height: 44 }, kind: 'integer' },
    { key: 'dmz.containersOpened', rect: { left: 786, top: rows[3], width: 174, height: 44 }, kind: 'integer' },
    { key: 'dmz.successfulExfils', rect: { left: 982, top: rows[0], width: 174, height: 44 }, kind: 'integer' },
    { key: 'dmz.dynamicOps', rect: { left: 982, top: rows[1], width: 174, height: 44 }, kind: 'integer' },
    { key: 'dmz.gamesPlayed', rect: { left: 982, top: rows[2], width: 174, height: 44 }, kind: 'integer' },
    { key: 'dmz.medicalItems', rect: { left: 982, top: rows[3], width: 174, height: 44 }, kind: 'integer' },
  ];
}

export class FastCardTemplateParser {
  async tryParse(input: {
    buffer: Buffer;
    mimeType: string;
    activisionId: string;
  }): Promise<ParsedCardResult | null> {
    const startedAt = Date.now();
    let meta: Metadata;
    try {
      meta = await sharp(input.buffer).metadata();
    } catch {
      return null;
    }

    if (!meta.width || !meta.height || meta.width < 400 || meta.height < 300) {
      return null;
    }

    const aspect = meta.width / meta.height;

    if (aspect >= 0.65 && aspect <= 0.85) {
      const { data, info } = await sharp(input.buffer)
        .resize(900, 1200, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const footer = measureRegionColors(data, info.width, info.channels, {
        left: 120,
        top: 1030,
        width: 660,
        height: 70,
      });
      const mpTitle = measureRegionColors(data, info.width, info.channels, {
        left: 340,
        top: 185,
        width: 220,
        height: 40,
      });

      if (
        footer.whitePct < 8 ||
        footer.goldPct < 2 ||
        mpTitle.whitePct < 10 ||
        mpTitle.goldPct > 3
      ) {
        console.warn('[parser] fast-template deferred (portrait_signature_mismatch)');
        return null;
      }

      const decoded = decodeBoxMap(data, info.width, info.channels, makePortraitMpSpecs());
      if (!decoded.ok) {
        console.warn(`[parser] fast-template deferred (${decoded.reason})`);
        return null;
      }

      const v = decoded.values;
      const result = normalizeParsedCard({
        parsedActivisionId: input.activisionId,
        season: 'Season 01',
        multiplayer: {
          timePlayed: v['mp.timePlayed'] ?? null,
          kills: v['mp.kills'] ?? null,
          kdRatio: v['mp.kdRatio'] ?? null,
          highestStreak: v['mp.highestStreak'] ?? null,
          wins: v['mp.wins'] ?? null,
          gamesPlayed: v['mp.gamesPlayed'] ?? null,
          winLossRatio: v['mp.winLossRatio'] ?? null,
          accuracyPercent: v['mp.accuracyPercent'] ?? null,
        },
        dmz: EMPTY_DMZ_RAW,
        battleRoyale: EMPTY_WARZONE_RAW,
        resurgence: EMPTY_WARZONE_RAW,
      });

      console.log(
        `[parser] fast-template (1-mode portrait) parsed in ${Date.now() - startedAt}ms (minScore=${decoded.minScore.toFixed(2)}, minMargin=${decoded.minMargin.toFixed(3)})`,
      );
      return result;
    }

    if (aspect >= 1.75 && aspect <= 2.08) {
      const { data, info } = await sharp(input.buffer)
        .resize(1200, 628, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const banner4Mode = measureRegionColors(data, info.width, info.channels, {
        left: 215,
        top: 575,
        width: 770,
        height: 25,
      });
      const banner2Mode = measureRegionColors(data, info.width, info.channels, {
        left: 280,
        top: 515,
        width: 640,
        height: 42,
      });
      const left4ModeDmzLogo = measureRegionColors(data, info.width, info.channels, {
        left: 250,
        top: 70,
        width: 135,
        height: 55,
      });
      const right4ModeWarzone = measureRegionColors(data, info.width, info.channels, {
        left: 905,
        top: 70,
        width: 135,
        height: 45,
      });

      const is4Mode =
        banner4Mode.whitePct >= 8 &&
        banner2Mode.goldPct < 2 &&
        left4ModeDmzLogo.goldPct >= 4 &&
        right4ModeWarzone.whitePct >= 15;

      if (is4Mode) {
        const decoded = decodeBoxMap(data, info.width, info.channels, makeLandscape4ModeSpecs());
        if (!decoded.ok) {
          console.warn(`[parser] fast-template deferred (${decoded.reason})`);
          return null;
        }

        const v = decoded.values;
        const result = normalizeParsedCard({
          parsedActivisionId: input.activisionId,
          season: 'Season 01',
          multiplayer: {
            timePlayed: v['mp.timePlayed'] ?? null,
            kills: v['mp.kills'] ?? null,
            kdRatio: v['mp.kdRatio'] ?? null,
            highestStreak: v['mp.highestStreak'] ?? null,
            wins: v['mp.wins'] ?? null,
            gamesPlayed: null,
            winLossRatio: null,
            accuracyPercent: null,
          },
          dmz: {
            timePlayed: v['dmz.timePlayed'] ?? null,
            playerEliminations: v['dmz.playerEliminations'] ?? null,
            hostileEliminations: v['dmz.hostileEliminations'] ?? null,
            containersOpened: v['dmz.containersOpened'] ?? null,
            successfulExfils: v['dmz.successfulExfils'] ?? null,
            dynamicOps: v['dmz.dynamicOps'] ?? null,
            gamesPlayed: v['dmz.gamesPlayed'] ?? null,
            medicalItems: v['dmz.medicalItems'] ?? null,
          },
          battleRoyale: {
            timePlayed: v['br.timePlayed'] ?? null,
            kills: v['br.kills'] ?? null,
            kdRatio: v['br.kdRatio'] ?? null,
            highestKillsPerGame: v['br.highestKillsPerGame'] ?? null,
            wins: v['br.wins'] ?? null,
          },
          resurgence: {
            timePlayed: v['res.timePlayed'] ?? null,
            kills: v['res.kills'] ?? null,
            kdRatio: v['res.kdRatio'] ?? null,
            highestKillsPerGame: v['res.highestKillsPerGame'] ?? null,
            wins: v['res.wins'] ?? null,
          },
        });

        console.log(
          `[parser] fast-template (4-mode landscape) parsed in ${Date.now() - startedAt}ms (minScore=${decoded.minScore.toFixed(2)}, minMargin=${decoded.minMargin.toFixed(3)})`,
        );
        return result;
      }

      const left2ModeMpHeader = measureRegionColors(data, info.width, info.channels, {
        left: 150,
        top: 132,
        width: 145,
        height: 25,
      });
      const right2ModeDmzLogo = measureRegionColors(data, info.width, info.channels, {
        left: 900,
        top: 70,
        width: 140,
        height: 65,
      });

      const is2ModeMpDmz =
        banner2Mode.whitePct >= 12 &&
        banner2Mode.goldPct >= 2 &&
        left2ModeMpHeader.whitePct >= 10 &&
        left2ModeMpHeader.goldPct <= 2 &&
        right2ModeDmzLogo.goldPct >= 4 &&
        right2ModeDmzLogo.whitePct <= 5;

      if (is2ModeMpDmz) {
        const decoded = decodeBoxMap(data, info.width, info.channels, makeLandscape2ModeSpecs());
        if (!decoded.ok) {
          console.warn(`[parser] fast-template deferred (${decoded.reason})`);
          return null;
        }

        const v = decoded.values;
        const result = normalizeParsedCard({
          parsedActivisionId: input.activisionId,
          season: 'Season 01',
          multiplayer: {
            timePlayed: v['mp.timePlayed'] ?? null,
            kills: v['mp.kills'] ?? null,
            kdRatio: v['mp.kdRatio'] ?? null,
            highestStreak: v['mp.highestStreak'] ?? null,
            wins: v['mp.wins'] ?? null,
            gamesPlayed: v['mp.gamesPlayed'] ?? null,
            winLossRatio: v['mp.winLossRatio'] ?? null,
            accuracyPercent: v['mp.accuracyPercent'] ?? null,
          },
          dmz: {
            timePlayed: v['dmz.timePlayed'] ?? null,
            playerEliminations: v['dmz.playerEliminations'] ?? null,
            hostileEliminations: v['dmz.hostileEliminations'] ?? null,
            containersOpened: v['dmz.containersOpened'] ?? null,
            successfulExfils: v['dmz.successfulExfils'] ?? null,
            dynamicOps: v['dmz.dynamicOps'] ?? null,
            gamesPlayed: v['dmz.gamesPlayed'] ?? null,
            medicalItems: v['dmz.medicalItems'] ?? null,
          },
          battleRoyale: EMPTY_WARZONE_RAW,
          resurgence: EMPTY_WARZONE_RAW,
        });

        console.log(
          `[parser] fast-template (2-mode landscape) parsed in ${Date.now() - startedAt}ms (minScore=${decoded.minScore.toFixed(2)}, minMargin=${decoded.minMargin.toFixed(3)})`,
        );
        return result;
      }

      console.warn('[parser] fast-template deferred (landscape_signature_mismatch)');
      return null;
    }

    return null;
  }
}
