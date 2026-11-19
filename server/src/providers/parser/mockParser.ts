import { buildMockCombatRecordModes } from '../x/mockXProvider.js';
import { normalizeParsedCard, type ImageParser, type ParsedCardResult } from './types.js';

export class MockImageParser implements ImageParser {
  readonly name = 'mock' as const;

  async parse(input: {
    buffer: Buffer;
    mimeType: string;
    activisionId: string;
  }): Promise<ParsedCardResult> {
    const modes = buildMockCombatRecordModes(input.activisionId);
    return normalizeParsedCard({
      parsedActivisionId: input.activisionId,
      season: 'Season 01',
      multiplayer: modes.multiplayer,
      dmz: modes.dmz,
      battleRoyale: modes.battleRoyale,
      resurgence: modes.resurgence,
    });
  }
}
