import fs from 'node:fs';
import path from 'node:path';

export type PrinterMode = 'usb' | 'ethernet';
export type CutMode = 'none' | 'partial' | 'full';

export interface AppConfig {
  printerMode: PrinterMode;
  appHost: string;
  appPort: number;
  apiKey?: string;
  rateLimitPerMinute: number;
  maxChars: number;
  feedLines: number;
  cutMode: CutMode;
  connectTimeoutMs: number;
  writeTimeoutMs: number;
  usbVendorId?: number;
  usbProductId?: number;
  usbDevicePath?: string;
  printerHost?: string;
  printerPort: number;
  dbPath: string;
  configPath?: string;
  requireApiKey: boolean;
}

interface RawConfig {
  [key: string]: unknown;
}

function readOptionalConfig(configPath?: string): RawConfig {
  if (!configPath) {
    return {};
  }

  if (!fs.existsSync(configPath)) {
    return {};
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  try {
    return JSON.parse(raw) as RawConfig;
  } catch (error) {
    throw new Error(`Failed to parse config file at ${configPath}`);
  }
}

function toValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const stringValue = String(value);
  return stringValue.length === 0 ? undefined : stringValue;
}

function parseNumber(value: string | undefined, name: string, fallback?: number): number {
  if (value === undefined || value === '') {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`${name} is required`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return parsed;
}

function parsePositiveInt(value: string | undefined, name: string, fallback?: number): number {
  const parsed = parseNumber(value, name, fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, name: string, fallback?: number): number {
  const parsed = parseNumber(value, name, fallback);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseHexOrInt(value: string | undefined, name: string): number {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  const normalized = value.trim().toLowerCase();
  const parsed = normalized.startsWith('0x') ? Number.parseInt(normalized, 16) : Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a valid hex or integer`);
  }
  return parsed;
}

function isLocalhost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

function resolvePath(value: string | undefined, fallback: string): string {
  const raw = value && value.trim().length > 0 ? value : fallback;
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export function loadConfig(): { config: AppConfig; redacted: Record<string, unknown> } {
  const rawConfigPath = toValue(process.env.CONFIG_PATH);
  const configPath = rawConfigPath ? resolvePath(rawConfigPath, rawConfigPath) : undefined;
  const fileConfig = readOptionalConfig(configPath);

  const get = (key: string): string | undefined => {
    const envValue = toValue(process.env[key]);
    if (envValue !== undefined) {
      return envValue;
    }
    return toValue(fileConfig[key]);
  };

  const printerMode = get('PRINTER_MODE');
  if (printerMode !== 'usb' && printerMode !== 'ethernet') {
    throw new Error('PRINTER_MODE must be usb or ethernet');
  }

  const appHost = get('APP_HOST') ?? '127.0.0.1';
  const appPort = parsePositiveInt(get('APP_PORT'), 'APP_PORT', 3000);
  const apiKey = get('API_KEY');
  const rateLimitPerMinute = parsePositiveInt(get('RATE_LIMIT_PER_MINUTE'), 'RATE_LIMIT_PER_MINUTE', 60);
  const maxChars = parsePositiveInt(get('MAX_CHARS'), 'MAX_CHARS', 1000);
  const feedLines = parseNonNegativeInt(get('FEED_LINES'), 'FEED_LINES', 3);
  const cutModeRaw = get('CUT_MODE') ?? 'partial';
  if (cutModeRaw !== 'none' && cutModeRaw !== 'partial' && cutModeRaw !== 'full') {
    throw new Error('CUT_MODE must be none, partial, or full');
  }
  const connectTimeoutMs = parsePositiveInt(get('CONNECT_TIMEOUT_MS'), 'CONNECT_TIMEOUT_MS', 2000);
  const writeTimeoutMs = parsePositiveInt(get('WRITE_TIMEOUT_MS'), 'WRITE_TIMEOUT_MS', 2000);

  let usbVendorId: number | undefined;
  let usbProductId: number | undefined;
  let usbDevicePath: string | undefined;
  let printerHost: string | undefined;
  let printerPort = 9100;

  if (printerMode === 'usb') {
    usbVendorId = parseHexOrInt(get('USB_VENDOR_ID'), 'USB_VENDOR_ID');
    usbProductId = parseHexOrInt(get('USB_PRODUCT_ID'), 'USB_PRODUCT_ID');
    const usbPathRaw = get('USB_DEVICE_PATH');
    usbDevicePath = usbPathRaw ? resolvePath(usbPathRaw, usbPathRaw) : undefined;
  }

  if (printerMode === 'ethernet') {
    printerHost = get('PRINTER_HOST');
    if (!printerHost) {
      throw new Error('PRINTER_HOST is required in ethernet mode');
    }
    printerPort = parsePositiveInt(get('PRINTER_PORT'), 'PRINTER_PORT', 9100);
  }

  const dbPath = resolvePath(get('DB_PATH'), path.join('data', 'receipty.sqlite'));

  const requireApiKey = !isLocalhost(appHost);
  if (requireApiKey && (!apiKey || apiKey.length === 0)) {
    throw new Error('API_KEY is required when APP_HOST is not localhost');
  }

  const config: AppConfig = {
    printerMode,
    appHost,
    appPort,
    apiKey,
    rateLimitPerMinute,
    maxChars,
    feedLines,
    cutMode: cutModeRaw,
    connectTimeoutMs,
    writeTimeoutMs,
    usbVendorId,
    usbProductId,
    usbDevicePath,
    printerHost,
    printerPort,
    dbPath,
    configPath,
    requireApiKey
  };

  const redacted = {
    PRINTER_MODE: config.printerMode,
    APP_HOST: config.appHost,
    APP_PORT: config.appPort,
    API_KEY: config.apiKey ? 'redacted' : undefined,
    RATE_LIMIT_PER_MINUTE: config.rateLimitPerMinute,
    MAX_CHARS: config.maxChars,
    FEED_LINES: config.feedLines,
    CUT_MODE: config.cutMode,
    CONNECT_TIMEOUT_MS: config.connectTimeoutMs,
    WRITE_TIMEOUT_MS: config.writeTimeoutMs,
    USB_VENDOR_ID: config.usbVendorId,
    USB_PRODUCT_ID: config.usbProductId,
    USB_DEVICE_PATH: config.usbDevicePath,
    PRINTER_HOST: config.printerHost,
    PRINTER_PORT: config.printerPort,
    DB_PATH: config.dbPath,
    CONFIG_PATH: config.configPath
  };

  return { config, redacted };
}
