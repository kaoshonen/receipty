import sharp from 'sharp';
import { CutMode } from './config';

const DEFAULT_IMAGE_WIDTH = 384;
const DEFAULT_THRESHOLD = 128;

export interface EscPosImageOptions {
  width?: number;
  threshold?: number;
}

export interface EscPosImageResult {
  payload: Buffer;
  width: number;
  height: number;
}

export function buildEscPosPayload(text: string, feedLines: number, cutMode: CutMode): Buffer {
  const chunks: Buffer[] = [];
  chunks.push(buildEscPosTextPayload(text));
  chunks.push(buildEscPosFooter(feedLines, cutMode));
  return Buffer.concat(chunks);
}

export async function buildEscPosImagePayload(
  image: Buffer,
  options: EscPosImageOptions = {}
): Promise<EscPosImageResult> {
  const width = options.width ?? DEFAULT_IMAGE_WIDTH;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  const { data, info } = await sharp(image)
    .flatten({ background: '#ffffff' })
    .resize({ width, fit: 'contain', background: '#ffffff' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (!info.width || !info.height) {
    throw new Error('Unable to read image dimensions.');
  }

  const bytesPerRow = Math.ceil(info.width / 8);
  const raster = Buffer.alloc(bytesPerRow * info.height);

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const pixelIndex = y * info.width + x;
      const value = data[pixelIndex];
      if (value < threshold) {
        const byteIndex = y * bytesPerRow + (x >> 3);
        raster[byteIndex] |= 1 << (7 - (x & 7));
      }
    }
  }

  const header = Buffer.from([
    0x1d,
    0x76,
    0x30,
    0x00,
    bytesPerRow & 0xff,
    (bytesPerRow >> 8) & 0xff,
    info.height & 0xff,
    (info.height >> 8) & 0xff
  ]);

  return {
    payload: Buffer.concat([header, raster]),
    width: info.width,
    height: info.height
  };
}

export async function buildEscPosJobPayload(options: {
  text?: string;
  image?: Buffer | null;
  feedLines: number;
  cutMode: CutMode;
  imageWidth?: number;
}): Promise<Buffer> {
  const chunks: Buffer[] = [];
  if (options.text) {
    chunks.push(buildEscPosTextPayload(options.text, false));
  }
  if (options.image) {
    const imageResult = await buildEscPosImagePayload(options.image, { width: options.imageWidth });
    chunks.push(imageResult.payload);
  }
  chunks.push(buildEscPosFooter(options.feedLines, options.cutMode));
  return Buffer.concat(chunks);
}

function buildEscPosTextPayload(text: string, allowEmpty = true): Buffer {
  if (!text) {
    return allowEmpty ? Buffer.from('\n', 'ascii') : Buffer.alloc(0);
  }
  const normalizedText = text.endsWith('\n') ? text : `${text}\n`;
  return Buffer.from(normalizedText, 'ascii');
}

function buildEscPosFooter(feedLines: number, cutMode: CutMode): Buffer {
  const chunks: Buffer[] = [];
  if (feedLines > 0) {
    chunks.push(Buffer.alloc(feedLines, 0x0a));
  }
  if (cutMode === 'full') {
    chunks.push(Buffer.from([0x1d, 0x56, 0x00]));
  }
  if (cutMode === 'partial') {
    chunks.push(Buffer.from([0x1d, 0x56, 0x01]));
  }
  return Buffer.concat(chunks);
}
