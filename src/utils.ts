import crypto from 'node:crypto';

export function sanitizeText(input: string): string {
  const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let output = '';
  for (let i = 0; i < normalized.length; i += 1) {
    const code = normalized.charCodeAt(i);
    if (code === 0x0a) {
      output += '\n';
      continue;
    }
    if (code === 0x09) {
      output += '\t';
      continue;
    }
    if (code >= 0x20 && code <= 0x7e) {
      output += normalized[i];
    }
  }
  return output;
}

export function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function hashBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function previewText(text: string, maxLength = 120): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength);
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatIso(date = new Date()): string {
  return date.toISOString();
}

export function formatDisplayTime(
  value: string | Date,
  options: { timeZone?: string } = {}
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value instanceof Date ? '' : value;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: options.timeZone,
  });
  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  const month = lookup.month;
  const day = lookup.day;
  const year = lookup.year;
  const hour = lookup.hour;
  const minute = lookup.minute;
  const dayPeriod = lookup.dayPeriod;

  if (!month || !day || !year || !hour || !minute || !dayPeriod) {
    return formatter.format(date);
  }

  return `${month} ${day}, ${year} ${hour}:${minute} ${dayPeriod}`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
