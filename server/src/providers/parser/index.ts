import type { AppConfig } from '../../config.js';
import { FastCardTemplateParser } from './fastCardTemplateParser.js';
import { GeminiVisionParser } from './geminiVisionParser.js';
import { HybridImageParser } from './hybridParser.js';
import { MockImageParser } from './mockParser.js';
import { TesseractImageParser } from './tesseractParser.js';
import type { ImageParser } from './types.js';

export * from './types.js';
export { FastCardTemplateParser } from './fastCardTemplateParser.js';
export { GeminiVisionParser, COMBAT_RECORD_RESPONSE_JSON_SCHEMA } from './geminiVisionParser.js';
export { HybridImageParser } from './hybridParser.js';
export { TesseractImageParser } from './tesseractParser.js';
export { MockImageParser } from './mockParser.js';

export function createImageParser(config: AppConfig): ImageParser {
  if (config.parserProvider === 'mock') {
    return new MockImageParser();
  }

  const fastParser = new FastCardTemplateParser();

  if (config.parserProvider === 'tesseract') {
    return new HybridImageParser(fastParser, new TesseractImageParser());
  }

  if (!config.geminiApiKey) {
    if (config.xProvider === 'mock') {
      console.warn(
        '[parser] GEMINI_API_KEY missing while X_PROVIDER=mock; using mock parser.',
      );
      return new MockImageParser();
    }
    console.warn(
      '[parser] GEMINI_API_KEY missing; falling back to local Tesseract OCR parser.',
    );
    return new HybridImageParser(fastParser, new TesseractImageParser());
  }

  return new HybridImageParser(
    fastParser,
    new GeminiVisionParser({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
    }),
  );
}
