import type { ParserProviderKind } from '@mw4trackstats/shared';
import type { FastCardTemplateParser } from './fastCardTemplateParser.js';
import type { ImageParser, ParsedCardResult } from './types.js';

export class HybridImageParser implements ImageParser {
  readonly name: ParserProviderKind;

  constructor(
    private readonly fastParser: FastCardTemplateParser,
    private readonly fallbackParser: ImageParser,
  ) {
    this.name = fallbackParser.name;
  }

  async parse(input: {
    buffer: Buffer;
    mimeType: string;
    activisionId: string;
  }): Promise<ParsedCardResult> {
    const fastResult = await this.fastParser.tryParse(input);
    if (fastResult) {
      return fastResult;
    }
    return this.fallbackParser.parse(input);
  }
}
