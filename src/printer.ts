import fs from 'node:fs/promises';
import net from 'node:net';
import escpos from 'escpos';
import escposUsb from 'escpos-usb';
import { AppConfig, CutMode } from './config';
import { buildEscPosPayload } from './escpos';
import type { AppLogger } from './logger';
import { parseStatusBytes, StatusReport } from './printer-status';
import { sleep, withTimeout } from './utils';

(escpos as any).USB = escposUsb;

export interface PrintResult {
  bytes: number;
}

export interface PrinterStatus {
  connected: boolean;
  details: Record<string, unknown>;
}

export type ControlCommand = 'feed' | 'cut' | 'status';

export interface ControlResult {
  confirmed: boolean;
  status?: StatusReport;
  error?: string;
}

export interface PrinterClient {
  print: (text: string) => Promise<PrintResult>;
  status: () => Promise<PrinterStatus>;
  control: (command: ControlCommand) => Promise<ControlResult>;
}

const DEFAULT_RETRIES = 2;
const STATUS_BYTES = 4;
const STATUS_REQUEST = Buffer.from([
  0x10, 0x04, 0x01,
  0x10, 0x04, 0x04,
  0x10, 0x04, 0x02,
  0x10, 0x04, 0x03
]);

export function createPrinter(config: AppConfig, logger: AppLogger): PrinterClient {
  const runExclusive = createOperationQueue();
  const baseClient = config.printerMode === 'usb' ? createUsbPrinter(config, logger) : createEthernetPrinter(config, logger);
  return {
    print: (text) => runExclusive(() => baseClient.print(text)),
    status: baseClient.status,
    control: (command) => runExclusive(() => baseClient.control(command))
  };
}

function createOperationQueue() {
  let tail = Promise.resolve();
  return async function runExclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = tail.then(action, action);
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}

function createUsbPrinter(config: AppConfig, logger: AppLogger): PrinterClient {
  const vid = config.usbVendorId as number;
  const pid = config.usbProductId as number;
  const devicePath = config.usbDevicePath;
  const totalFeedLines = config.feedLines + config.cutFeedLines;
  const cutMode = config.cutMode;
  const controlUnsupported: ControlResult = {
    confirmed: false,
    error: 'Printer control confirmation is not available in USB mode; command not sent.'
  };

  return {
    print: async (text) => {
      const payload = buildEscPosPayload(text, totalFeedLines, cutMode);
      if (devicePath) {
        await writeToDevicePath(devicePath, payload, config.writeTimeoutMs);
        return { bytes: payload.length };
      }

      await writeUsbViaEscpos(vid, pid, payload, text, totalFeedLines, cutMode);
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
    },
    control: async () => controlUnsupported
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

function createEthernetPrinter(config: AppConfig, logger: AppLogger): PrinterClient {
  const host = config.printerHost as string;
  const port = config.printerPort;
  const totalFeedLines = config.feedLines + config.cutFeedLines;
  const feedLines = Math.max(1, config.feedLines);
  const cutFeedLines = config.cutFeedLines;
  const cutMode = config.cutMode;
  const connectTimeout = config.connectTimeoutMs;
  const writeTimeout = config.writeTimeoutMs;

  return {
    print: async (text) => {
      const payload = buildEscPosPayload(text, totalFeedLines, cutMode);
      await retryNetwork(() => writeEthernetPayload(host, port, payload, connectTimeout, writeTimeout), logger);
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
    },
    control: async (command) => {
      if (command === 'cut' && cutMode === 'none') {
        return { confirmed: false, error: 'Cutting is disabled because CUT_MODE is set to none.' };
      }

      const status = await retryNetwork(
        () => executeEthernetControl(host, port, command, feedLines, cutFeedLines, cutMode, connectTimeout, writeTimeout),
        logger
      );

      if (command === 'status') {
        return { confirmed: true, status };
      }

      if (status.ok) {
        return { confirmed: true, status };
      }

      return {
        confirmed: false,
        status,
        error: 'Printer responded with an error while confirming the command.'
      };
    }
  };
}

async function retryNetwork<T>(action: () => Promise<T>, logger: AppLogger): Promise<T> {
  for (let attempt = 0; attempt <= DEFAULT_RETRIES; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= DEFAULT_RETRIES) {
        throw error;
      }
      const backoff = 150 + Math.floor(Math.random() * 200) + attempt * 150;
      logger.warn({ error, attempt: attempt + 1 }, 'network print failed, retrying');
      await sleep(backoff);
    }
  }
  throw new Error('network retry failed');
}

async function executeEthernetControl(
  host: string,
  port: number,
  command: ControlCommand,
  feedLines: number,
  cutFeedLines: number,
  cutMode: CutMode,
  connectTimeout: number,
  writeTimeout: number
): Promise<StatusReport> {
  const socket = await connectSocket(host, port, connectTimeout);

  try {
    if (command === 'feed') {
      await writeSocketPayload(socket, buildFeedPayload(feedLines), writeTimeout);
    }
    if (command === 'cut') {
      await writeSocketPayload(socket, buildCutPayload(cutFeedLines, cutMode), writeTimeout);
    }

    await writeSocketPayload(socket, STATUS_REQUEST, writeTimeout);
    const statusBytes = await readSocketBytes(socket, STATUS_BYTES, writeTimeout);
    return parseStatusBytes(Array.from(statusBytes));
  } finally {
    socket.end();
    socket.destroy();
  }
}

function buildFeedPayload(feedLines: number): Buffer {
  const lines = Math.max(1, feedLines);
  return Buffer.alloc(lines, 0x0a);
}

function buildCutPayload(feedLines: number, cutMode: CutMode): Buffer {
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

async function connectSocket(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  const socket = new net.Socket();
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        socket.destroy();
        reject(error);
      };
      socket.once('error', onError);
      socket.connect(port, host, () => {
        socket.off('error', onError);
        resolve();
      });
    }),
    timeoutMs,
    'ethernet connect timeout'
  );
  return socket;
}

async function writeSocketPayload(socket: net.Socket, payload: Buffer, timeoutMs: number): Promise<void> {
  if (payload.length === 0) {
    return;
  }
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      socket.write(payload, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    }),
    timeoutMs,
    'ethernet write timeout'
  );
}

async function readSocketBytes(socket: net.Socket, length: number, timeoutMs: number): Promise<Buffer> {
  return withTimeout(
    new Promise<Buffer>((resolve, reject) => {
      let buffer = Buffer.alloc(0);

      const onData = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length >= length) {
          cleanup();
          resolve(buffer.subarray(0, length));
        }
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const onClose = () => {
        cleanup();
        reject(new Error('socket closed before status response'));
      };

      const cleanup = () => {
        socket.off('data', onData);
        socket.off('error', onError);
        socket.off('close', onClose);
      };

      socket.on('data', onData);
      socket.once('error', onError);
      socket.once('close', onClose);
    }),
    timeoutMs,
    'ethernet status read timeout'
  );
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
