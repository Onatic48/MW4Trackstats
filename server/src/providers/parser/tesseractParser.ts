import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import {
  normalizeParsedCard,
  ParseFailedError,
  type ImageParser,
  type ParsedCardResult,
} from './types.js';

interface CropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const COLUMN_X = {
  multiplayer: { left: 32, width: 215 },
  dmz: { left: 250, width: 215 },
  battleRoyale: { left: 816, width: 215 },
  resurgence: { left: 1034, width: 215 },
} as const;

const ROW_Y = [
  { top: 152, height: 92 },
  { top: 248, height: 92 },
  { top: 344, height: 92 },
  { top: 440, height: 92 },
  { top: 536, height: 92 },
] as const;

function extractValueLine(ocrText: string): string | null {
  const lines = ocrText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return null;
  }

  // The bottom line in each cell contains the metric value; top line is the label.
  const candidate = lines[lines.length - 1] ?? '';
  if (/^[-—_]+$/.test(candidate)) {
    return '--';
  }
  return candidate;
}

export class TesseractImageParser implements ImageParser {
  readonly name = 'tesseract' as const;

  async parse(input: {
    buffer: Buffer;
    mimeType: string;
    activisionId: string;
  }): Promise<ParsedCardResult> {
    const normalizedImage = await sharp(input.buffer)
      .resize(1280, 720, { fit: 'fill' })
      .toBuffer();

    const worker = await createWorker('eng');

    try {
      const readCell = async (box: CropBox): Promise<string | null> => {
        const cropped = await sharp(normalizedImage)
          .extract(box)
          .resize(box.width * 2, box.height * 2)
          .grayscale()
          .negate({ alpha: false })
          .normalise()
          .png()
          .toBuffer();

        const result = await worker.recognize(cropped);
        return extractValueLine(result.data.text);
      };

      const readColumn = async (col: { left: number; width: number }) => {
        const values: Array<string | null> = [];
        for (const row of ROW_Y) {
          values.push(
            await readCell({
              left: col.left,
              top: row.top,
              width: col.width,
              height: row.height,
            }),
          );
        }
        return values;
      };

      const mp = await readColumn(COLUMN_X.multiplayer);
      const dmz = await readColumn(COLUMN_X.dmz);
      const br = await readColumn(COLUMN_X.battleRoyale);
      const res = await readColumn(COLUMN_X.resurgence);

      return normalizeParsedCard({
        parsedActivisionId: input.activisionId,
        season: 'Season 01',
        multiplayer: {
          timePlayed: mp[0] ?? null,
          kills: mp[1] ?? null,
          kdRatio: mp[2] ?? null,
          highestStreak: mp[3] ?? null,
          wins: mp[4] ?? null,
        },
        dmz: {
          timePlayed: dmz[0] ?? null,
          playerEliminations: dmz[1] ?? null,
          hostileEliminations: dmz[2] ?? null,
          containersOpened: dmz[3] ?? null,
          successfulExfils: dmz[4] ?? null,
        },
        battleRoyale: {
          timePlayed: br[0] ?? null,
          kills: br[1] ?? null,
          kdRatio: br[2] ?? null,
          highestKillsPerGame: br[3] ?? null,
          wins: br[4] ?? null,
        },
        resurgence: {
          timePlayed: res[0] ?? null,
          kills: res[1] ?? null,
          kdRatio: res[2] ?? null,
          highestKillsPerGame: res[3] ?? null,
          wins: res[4] ?? null,
        },
      });
    } catch (error) {
      if (error instanceof ParseFailedError) {
        throw error;
      }
      throw new ParseFailedError(
        `Tesseract OCR failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await worker.terminate();
    }
  }
}
