import { GoogleGenAI, MediaResolution, ThinkingLevel } from '@google/genai';
import {
  normalizeParsedCard,
  ParseFailedError,
  type ImageParser,
  type ParsedCardResult,
} from './types.js';

const DEFAULT_ATTEMPT_TIMEOUT_MS = 18_000;
const RETRY_PAUSE_MS = 800;
const DEFAULT_FALLBACK_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
] as const;

export function resolveThinkingLevel(model: string): ThinkingLevel {
  if (/flash-lite|3\.5-flash|3\.6-flash|3-flash-preview/i.test(model)) {
    return ThinkingLevel.MINIMAL;
  }
  return ThinkingLevel.LOW;
}

export function isTransientGeminiError(err: unknown): boolean {
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? (err as { status?: unknown }).status
      : undefined;
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return false;
  }
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err ?? '');

  if (
    /\b(400|401|403|404)\b|API_KEY_INVALID|PERMISSION_DENIED|INVALID_ARGUMENT|UNAUTHENTICATED/i.test(
      msg,
    )
  ) {
    return false;
  }

  if (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    /\b(503|500|502|504|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|TimeoutError|AbortError|aborted|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(
      msg,
    )
  ) {
    return true;
  }

  return false;
}

function summarizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  return raw.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const nullableStringSchema = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
};

const nullableNumberSchema = {
  anyOf: [{ type: 'number' }, { type: 'null' }],
};

export const COMBAT_RECORD_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    parsedActivisionId: {
      ...nullableStringSchema,
      description: 'Activision ID printed at top right of the card, or null if unreadable',
    },
    season: {
      type: 'string',
      description: 'Season label if visible, otherwise "Season 01"',
    },
    multiplayer: {
      type: 'object',
      properties: {
        timePlayed: nullableStringSchema,
        kills: nullableNumberSchema,
        kdRatio: nullableNumberSchema,
        highestStreak: nullableNumberSchema,
        wins: nullableNumberSchema,
        gamesPlayed: nullableNumberSchema,
        winLossRatio: nullableNumberSchema,
        accuracyPercent: nullableNumberSchema,
      },
      required: [
        'timePlayed',
        'kills',
        'kdRatio',
        'highestStreak',
        'wins',
        'gamesPlayed',
        'winLossRatio',
        'accuracyPercent',
      ],
    },
    dmz: {
      type: 'object',
      properties: {
        timePlayed: nullableStringSchema,
        playerEliminations: nullableNumberSchema,
        hostileEliminations: nullableNumberSchema,
        containersOpened: nullableNumberSchema,
        successfulExfils: nullableNumberSchema,
        dynamicOps: nullableNumberSchema,
        gamesPlayed: nullableNumberSchema,
        medicalItems: nullableNumberSchema,
      },
      required: [
        'timePlayed',
        'playerEliminations',
        'hostileEliminations',
        'containersOpened',
        'successfulExfils',
        'dynamicOps',
        'gamesPlayed',
        'medicalItems',
      ],
    },
    battleRoyale: {
      type: 'object',
      properties: {
        timePlayed: nullableStringSchema,
        kills: nullableNumberSchema,
        kdRatio: nullableNumberSchema,
        highestKillsPerGame: nullableNumberSchema,
        wins: nullableNumberSchema,
        gamesPlayed: nullableNumberSchema,
        winLossRatio: nullableNumberSchema,
        accuracyPercent: nullableNumberSchema,
      },
      required: [
        'timePlayed',
        'kills',
        'kdRatio',
        'highestKillsPerGame',
        'wins',
        'gamesPlayed',
        'winLossRatio',
        'accuracyPercent',
      ],
    },
    resurgence: {
      type: 'object',
      properties: {
        timePlayed: nullableStringSchema,
        kills: nullableNumberSchema,
        kdRatio: nullableNumberSchema,
        highestKillsPerGame: nullableNumberSchema,
        wins: nullableNumberSchema,
        gamesPlayed: nullableNumberSchema,
        winLossRatio: nullableNumberSchema,
        accuracyPercent: nullableNumberSchema,
      },
      required: [
        'timePlayed',
        'kills',
        'kdRatio',
        'highestKillsPerGame',
        'wins',
        'gamesPlayed',
        'winLossRatio',
        'accuracyPercent',
      ],
    },
  },
  required: ['parsedActivisionId', 'season', 'multiplayer', 'dmz', 'battleRoyale', 'resurgence'],
} as const;

const EXTRACTION_PROMPT = [
  'Extract exact statistics from a Call of Duty @CODCombatRecord card image into strict JSON matching this exact shape:',
  '{"parsedActivisionId":string|null,"season":"Season 01","multiplayer":{"timePlayed":string|null,"kills":number|null,"kdRatio":number|null,"highestStreak":number|null,"wins":number|null,"gamesPlayed":number|null,"winLossRatio":number|null,"accuracyPercent":number|null},"dmz":{"timePlayed":string|null,"playerEliminations":number|null,"hostileEliminations":number|null,"containersOpened":number|null,"successfulExfils":number|null,"dynamicOps":number|null,"gamesPlayed":number|null,"medicalItems":number|null},"battleRoyale":{"timePlayed":string|null,"kills":number|null,"kdRatio":number|null,"highestKillsPerGame":number|null,"wins":number|null,"gamesPlayed":number|null,"winLossRatio":number|null,"accuracyPercent":number|null},"resurgence":{"timePlayed":string|null,"kills":number|null,"kdRatio":number|null,"highestKillsPerGame":number|null,"wins":number|null,"gamesPlayed":number|null,"winLossRatio":number|null,"accuracyPercent":number|null}}',
  'Layouts: 4-mode landscape (4 cols x 5 boxes), 2-mode landscape (8+8 boxes side by side, e.g. MW4 Multiplayer + DMZ including Dynamic Ops, Games Played, and Medical Items), or 1-mode portrait (8 boxes).',
  'Rules: convert "--" and unshown modes/fields to null (never 0); preserve real "0", "0.00", "0.00%" as 0; strip "%" from accuracyPercent ("30.00%" -> 30); keep TIME PLAYED strings verbatim ("14H 35M", "2D 4H", "1D 9H", "14M"); read top-left/top-right Activision ID as parsedActivisionId.',
].join('\n');

export interface GeminiClientLike {
  models: {
    generateContent(params: {
      model: string;
      contents: Array<{
        role: string;
        parts: Array<
          | { text: string }
          | { inlineData: { mimeType: string; data: string } }
        >;
      }>;
      config: {
        responseMimeType: string;
        responseJsonSchema?: unknown;
        thinkingConfig?: { thinkingLevel: ThinkingLevel };
        mediaResolution?: MediaResolution;
        temperature?: number;
        abortSignal?: AbortSignal;
      };
    }): Promise<{ text?: string | undefined }>;
  };
}

function buildCandidateModels(primaryModel: string, fallbackModels?: string[]): string[] {
  const sourceFallbacks =
    fallbackModels !== undefined
      ? fallbackModels
      : DEFAULT_FALLBACK_MODELS.filter(
          (candidate) => !(primaryModel === 'gemini-3.5-flash' && candidate === 'gemini-3.6-flash'),
        );

  const unique: string[] = [];
  for (const model of [primaryModel, ...sourceFallbacks]) {
    const trimmed = model.trim();
    if (trimmed && !unique.includes(trimmed)) {
      unique.push(trimmed);
    }
  }
  return unique;
}

export class GeminiVisionParser implements ImageParser {
  readonly name = 'gemini' as const;
  private readonly ai: GeminiClientLike;
  private readonly hasClientOverride: boolean;
  private readonly attemptTimeoutMs: number;
  private readonly candidateModels: string[];

  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      fallbackModels?: string[];
      attemptTimeoutMs?: number;
      clientOverride?: GeminiClientLike;
    },
  ) {
    this.hasClientOverride = Boolean(options.clientOverride);
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
    this.candidateModels = buildCandidateModels(options.model, options.fallbackModels);
    this.ai =
      options.clientOverride ??
      (new GoogleGenAI({
        apiKey: options.apiKey,
        httpOptions: { retryOptions: { attempts: 1 } },
      }) as unknown as GeminiClientLike);
  }

  private async attemptParseWithModel(
    model: string,
    promptText: string,
    mimeType: string,
    base64Data: string,
  ): Promise<ParsedCardResult> {
    const startedAt = Date.now();
    const response = await this.ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: resolveThinkingLevel(model) },
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
        temperature: 0,
        abortSignal: AbortSignal.timeout(this.attemptTimeoutMs),
      },
    });

    const elapsedMs = Date.now() - startedAt;
    const rawText = response.text?.trim();
    if (!rawText) {
      throw new ParseFailedError(`Gemini model ${model} returned an empty response`);
    }

    const cleanedText = rawText.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    let rawJson: unknown;
    try {
      rawJson = JSON.parse(cleanedText);
    } catch {
      throw new ParseFailedError(`Gemini model ${model} returned invalid JSON`);
    }

    const normalized = normalizeParsedCard(rawJson);
    console.log(`[parser] gemini (${model}) parsed in ${elapsedMs}ms`);
    return normalized;
  }

  async parse(input: {
    buffer: Buffer;
    mimeType: string;
    activisionId: string;
  }): Promise<ParsedCardResult> {
    const promptText = `${EXTRACTION_PROMPT}\nTarget player ID: ${input.activisionId}`;
    const base64Data = input.buffer.toString('base64');
    let lastError: unknown = null;

    for (const model of this.candidateModels) {
      const attemptStartedAt = Date.now();
      try {
        return await this.attemptParseWithModel(
          model,
          promptText,
          input.mimeType,
          base64Data,
        );
      } catch (err) {
        lastError = err;
        const elapsedMs = Date.now() - attemptStartedAt;
        if (err instanceof ParseFailedError || !isTransientGeminiError(err)) {
          throw err instanceof ParseFailedError
            ? err
            : new ParseFailedError(`Gemini model ${model} failed: ${summarizeError(err)}`);
        }
        console.warn(
          `[parser] ${model} transient failure after ${elapsedMs}ms: ${summarizeError(err)}`,
        );
      }
    }

    if (!this.hasClientOverride || this.candidateModels.length > 1) {
      const retryModel = this.candidateModels[0] ?? this.options.model;
      await sleep(RETRY_PAUSE_MS);
      const retryStartedAt = Date.now();
      try {
        return await this.attemptParseWithModel(
          retryModel,
          promptText,
          input.mimeType,
          base64Data,
        );
      } catch (err) {
        lastError = err;
        console.warn(
          `[parser] ${retryModel} retry failed after ${Date.now() - retryStartedAt}ms: ${summarizeError(err)}`,
        );
      }
    }

    if (lastError instanceof ParseFailedError) {
      throw lastError;
    }
    throw new ParseFailedError(
      `Gemini Vision parsing failed across models (${this.candidateModels.join(', ')}): ${summarizeError(lastError)}`,
    );
  }
}
