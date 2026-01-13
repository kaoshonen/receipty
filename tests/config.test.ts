import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const ORIGINAL_ENV = { ...process.env };

function setEnv(values: Record<string, string | undefined>) {
  process.env = { ...ORIGINAL_ENV, ...values };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('loadConfig', () => {
  it('loads ethernet configuration with defaults', () => {
    setEnv({
      PRINTER_MODE: 'ethernet',
      PRINTER_HOST: '192.168.1.50',
      APP_HOST: '127.0.0.1',
      APP_PORT: '3000'
    });

    const { config } = loadConfig();
    expect(config.printerMode).toBe('ethernet');
    expect(config.printerHost).toBe('192.168.1.50');
    expect(config.printerPort).toBe(9100);
  });

  it('requires API_KEY when binding off localhost', () => {
    setEnv({
      PRINTER_MODE: 'ethernet',
      PRINTER_HOST: '192.168.1.50',
      APP_HOST: '0.0.0.0'
    });

    expect(() => loadConfig()).toThrow('API_KEY is required');
  });

  it('accepts USB identifiers', () => {
    setEnv({
      PRINTER_MODE: 'usb',
      USB_VENDOR_ID: '0x04B8',
      USB_PRODUCT_ID: '0x0E15',
      APP_HOST: '127.0.0.1'
    });

    const { config } = loadConfig();
    expect(config.usbVendorId).toBe(0x04b8);
    expect(config.usbProductId).toBe(0x0e15);
  });
});
