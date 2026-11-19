import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

export const ALLOWED_MEDIA_HOSTS = new Set(['pbs.twimg.com', 'ton.twimg.com']);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

export interface SavedImageResult {
  filename: string;
  filePath: string;
  buffer: Buffer;
  mimeType: string;
}

export interface FetchedImageBuffer {
  buffer: Buffer;
  mimeType: string;
  finalUrl: string;
}

export function validateTrustedImageUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid image URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Blocked non-HTTPS image URL: ${parsed.protocol}`);
  }

  if (parsed.username || parsed.password) {
    throw new Error('Blocked image URL containing credentials');
  }

  if (parsed.port && parsed.port !== '443') {
    throw new Error(`Blocked non-standard port in image URL: ${parsed.port}`);
  }

  const host = parsed.hostname.toLowerCase();
  if (net.isIP(host) !== 0) {
    throw new Error(`Blocked direct IP image URL: ${host}`);
  }

  if (!ALLOWED_MEDIA_HOSTS.has(host)) {
    throw new Error(`Blocked untrusted image host: ${host}`);
  }

  return parsed;
}

export async function saveLocalImage(
  buffer: Buffer,
  mimeType: string,
  imagesDir: string,
): Promise<SavedImageResult> {
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image size out of bounds (${buffer.byteLength} bytes)`);
  }

  const normalizedMime = mimeType.split(';')[0]?.trim().toLowerCase() ?? 'image/png';
  const ext = MIME_TO_EXT[normalizedMime];
  if (!ext) {
    throw new Error(`Unsupported image MIME type: ${normalizedMime}`);
  }

  await fs.mkdir(imagesDir, { recursive: true });
  const filename = `${crypto.randomUUID()}.${ext}`;
  const filePath = path.join(imagesDir, filename);
  await fs.writeFile(filePath, buffer);

  return {
    filename,
    filePath,
    buffer,
    mimeType: normalizedMime,
  };
}

const DOWNLOAD_TIMEOUT_MS = 10_000;

export async function fetchTrustedXImageBuffer(
  imageUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchedImageBuffer> {
  let currentUrl = validateTrustedImageUrl(imageUrl);
  let response: Response | null = null;

  for (let hop = 0; hop < 4; hop += 1) {
    response = await fetchImpl(currentUrl.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: {
        'User-Agent': 'MW4Trackstats/1.0',
        Accept: 'image/png,image/jpeg,image/webp,*/*;q=0.8',
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('Redirect response missing Location header');
      }
      currentUrl = validateTrustedImageUrl(new URL(location, currentUrl).toString());
      continue;
    }

    break;
  }

  if (!response || !response.ok) {
    throw new Error(`Failed to fetch trusted X image: HTTP ${response?.status ?? 'unknown'}`);
  }

  const contentTypeHeader = response.headers.get('content-type') ?? '';
  const mimeType = contentTypeHeader.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!MIME_TO_EXT[mimeType]) {
    throw new Error(`Unexpected image content-type: ${mimeType || 'missing'}`);
  }

  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      throw new Error(`Image exceeds max byte limit (${contentLength} bytes)`);
    }
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image size out of bounds (${buffer.byteLength} bytes)`);
  }

  return {
    buffer,
    mimeType,
    finalUrl: currentUrl.toString(),
  };
}

export async function downloadTrustedXImage(
  imageUrl: string,
  imagesDir: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SavedImageResult> {
  const fetched = await fetchTrustedXImageBuffer(imageUrl, fetchImpl);
  return saveLocalImage(fetched.buffer, fetched.mimeType, imagesDir);
}
