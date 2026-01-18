import { CutMode } from './config';

export function buildEscPosPayload(text: string, feedLines: number, cutMode: CutMode): Buffer {
  const chunks: Buffer[] = [];
  const normalizedText = text.endsWith('\n') ? text : `${text}\n`;
  chunks.push(Buffer.from(normalizedText, 'ascii'));
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
