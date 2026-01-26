import { describe, expect, it } from 'vitest';
import { formatDisplayTime, sanitizeText } from '../src/utils';
import { buildEscPosPayload } from '../src/escpos';

describe('sanitizeText', () => {
  it('removes control characters and keeps printable text', () => {
    const input = 'Hello\u0007 World\n\u001b[0m';
    const output = sanitizeText(input);
    expect(output).toBe('Hello World\n[0m');
  });

  it('normalizes newlines', () => {
    const input = 'Line1\r\nLine2\rLine3';
    const output = sanitizeText(input);
    expect(output).toBe('Line1\nLine2\nLine3');
  });
});

describe('buildEscPosPayload', () => {
  it('adds feed lines and cut command', () => {
    const payload = buildEscPosPayload('Hi', 2, 'partial');
    expect(payload.slice(0, 3)).toEqual(Buffer.from('Hi\n', 'ascii'));
    expect(payload.includes(0x0a)).toBe(true);
    expect(payload.slice(-3)).toEqual(Buffer.from([0x1d, 0x56, 0x01]));
  });
});

describe('formatDisplayTime', () => {
  it('formats timestamps in 12-hour time', () => {
    const output = formatDisplayTime('2026-01-26T15:45:00Z', { timeZone: 'UTC' });
    expect(output).toBe('Jan 26, 2026 3:45 PM');
  });
});
