import fs from 'node:fs/promises';
import net from 'node:net';
import escpos from 'escpos';
import escposUsb from 'escpos-usb';
import type { Logger } from 'pino';
import { AppConfig, CutMode } from './config';
import { buildEscPosPayload } from './escpos';
import { sleep, withTimeout } from './utils';

(escpos as any).USB = escposUsb;

export interface PrintResult {
  bytes: number;
}

export interface PrinterStatus {
  connected: boolean;
  details: Record<string, unknown>;
}

export interface PrinterClient {
  print: (text: string) => Promise<PrintResult>;
  status: () => Promise<PrinterStatus>;
}

const DEFAULT_RETRIES = 2;

export function createPrinter(config: AppConfig, logger: Logger): PrinterClient {
  if (config.printerMode === 'usb') {
    return createUsbPrinter(config, logger);
  }
  return createEthernetPrinter(config, logger);
}

function createUsbPrinter(config: AppConfig, logger: Logger): PrinterClient {
  const vid = config.usbVendorId as number;
  const pid = config.usbProductId as number;
  const devicePath = config.usbDevicePath;
  const feedLines = config.feedLines;
  const cutMode = config.cutMode;

  return {
    print: async (text) => {
      const payload = buildEscPosPayload(text, feedLines, cutMode);
      if (devicePath) {
        await writeToDevicePath(devicePath, payload, config.writeTimeoutMs);
        return { bytes: payload.length };
      }

      await writeUsbViaEscpos(vid, pid, payload, text, feedLines, cutMode);
      return { bytes: payload.length };
    },
    status: async () => {
      if (devicePath) {
        try {
          await fs.access(devicePath);
          return { connected: true, details: { mode: 'usb', devicePath } };
        } catch (error) {
          return {
            connected: false,
            details: {
              mode: 'usb',
              devicePath,
              error: error instanceof Error ? error.message : String(error)
            }
          };
        }
      }

      try {
        await probeUsb(vid, pid, config.connectTimeoutMs);
        return { connected: true, details: { mode: 'usb', vendorId: vid, productId: pid } };
      } catch (error) {
        return {
          connected: false,
          details: {
            mode: 'usb',
            vendorId: vid,
            productId: pid,
            error: error instanceof Error ? error.message : String(error)
          }
        };
      }
    }
  };
}

async function writeToDevicePath(path: string, payload: Buffer, timeoutMs: number): Promise<void> {
  const handle = await fs.open(path, 'w');
  try {
    await withTimeout(handle.write(payload, 0, payload.length, null).then(() => undefined), timeoutMs, 'usb write timeout');
  } finally {
    await handle.close();
  }
}

async function writeUsbViaEscpos(
  vendorId: number,
  productId: number,
  payload: Buffer,
  text: string,
  feedLines: number,
  cutMode: CutMode
): Promise<void> {
  const device = new (escpos as any).USB(vendorId, productId);
  const printer = new (escpos as any).Printer(device);

  await new Promise<void>((resolve, reject) => {
    device.open((error: Error | null) => {
      if (error) {
        reject(error);
        return;
      }

      try {
        if (typeof printer.raw === 'function') {
          printer.raw(payload);
        } else {
          printer.text(text);
          if (feedLines > 0 && typeof printer.feed === 'function') {
            printer.feed(feedLines);
          }
          if (cutMode !== 'none' && typeof printer.cut === 'function') {
            printer.cut(cutMode === 'partial');
          }
        }
        if (typeof printer.close === 'function') {
          printer.close();
        }
        resolve();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

async function probeUsb(vendorId: number, productId: number, timeoutMs: number): Promise<void> {
  const device = new (escpos as any).USB(vendorId, productId);
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      device.open((error: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        if (typeof device.close === 'function') {
          device.close();
        }
        resolve();
      });
    }),
    timeoutMs,
    'usb connect timeout'
  );
}

function createEthernetPrinter(config: AppConfig, logger: Logger): PrinterClient {
  const host = config.printerHost as string;
  const port = config.printerPort;
  const feedLines = config.feedLines;
  const cutMode = config.cutMode;
  const connectTimeout = config.connectTimeoutMs;
  const writeTimeout = config.writeTimeoutMs;

  return {
    print: async (text) => {
      const payload = buildEscPosPayload(text, feedLines, cutMode);
      await retryNetwork(async () => {
        await writeEthernetPayload(host, port, payload, connectTimeout, writeTimeout);
      }, logger);
      return { bytes: payload.length };
    },
    status: async () => {
      try {
        await connectProbe(host, port, connectTimeout);
        return { connected: true, details: { mode: 'ethernet', host, port } };
      } catch (error) {
        return {
          connected: false,
          details: {
            mode: 'ethernet',
            host,
            port,
            error: error instanceof Error ? error.message : String(error)
          }
        };
      }
    }
  };
}

async function retryNetwork(action: () => Promise<void>, logger: Logger): Promise<void> {
  for (let attempt = 0; attempt <= DEFAULT_RETRIES; attempt += 1) {
    try {
      await action();
      return;
    } catch (error) {
      if (attempt >= DEFAULT_RETRIES) {
        throw error;
      }
      const backoff = 150 + Math.floor(Math.random() * 200) + attempt * 150;
      logger.warn({ error, attempt: attempt + 1 }, 'network print failed, retrying');
      await sleep(backoff);
    }
  }
}

async function connectProbe(host: string, port: number, timeoutMs: number): Promise<void> {
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      socket.once('error', (error) => {
        socket.destroy();
        reject(error);
      });
      socket.connect(port, host, () => {
        socket.end();
        resolve();
      });
    }),
    timeoutMs,
    'ethernet connect timeout'
  );
}

async function writeEthernetPayload(
  host: string,
  port: number,
  payload: Buffer,
  connectTimeout: number,
  writeTimeout: number
): Promise<void> {
  const socket = new net.Socket();

  await withTimeout(
    new Promise<void>((resolve, reject) => {
      socket.once('error', (error) => {
        socket.destroy();
        reject(error);
      });
      socket.connect(port, host, () => resolve());
    }),
    connectTimeout,
    'ethernet connect timeout'
  );

  await withTimeout(
    new Promise<void>((resolve, reject) => {
      socket.once('error', (error) => {
        socket.destroy();
        reject(error);
      });
      socket.write(payload, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    }),
    writeTimeout,
    'ethernet write timeout'
  );

  socket.end();
}
