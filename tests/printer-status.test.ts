import { describe, expect, it } from 'vitest';
import { parseStatusBytes } from '../src/printer-status';

describe('parseStatusBytes', () => {
  it('returns ok when no error bits are set', () => {
    const report = parseStatusBytes([0x00, 0x00, 0x00, 0x00]);
    expect(report.ok).toBe(true);
    expect(report.statuses).toHaveLength(4);
    expect(report.statuses[0].className).toBe('PrinterStatus');
  });

  it('returns not ok when an error bit is set', () => {
    const report = parseStatusBytes([0x08, 0x00, 0x00, 0x00]);
    expect(report.ok).toBe(false);
    const hasError = report.statuses.some((section) =>
      section.statuses.some((entry) => entry.status === 'error')
    );
    expect(hasError).toBe(true);
  });
});
