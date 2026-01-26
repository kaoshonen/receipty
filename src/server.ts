import 'dotenv/config';
import path from 'node:path';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import { loadConfig } from './config';
import { openDb } from './db';
import { createJobRepository } from './jobs';
import { JobQueue } from './queue';
import { createPrinter } from './printer';
import { buildEscPosJobPayload } from './escpos';
import { formatIso, hashBuffer, hashText, previewText, sanitizeText } from './utils';
import type { StatusReport } from './printer-status';
import { renderActivity, renderControl, renderHome, renderJobDetail } from './ui';

const { config, redacted } = loadConfig();

const fastify = Fastify({
  logger: true,
  bodyLimit: Math.max(1024, config.maxChars * 4)
});

fastify.log.info({ config: redacted }, 'config loaded');

const db = openDb(config.dbPath);
const repo = createJobRepository(db);
const printer = createPrinter(config, fastify.log);
const queue = new JobQueue(repo, printer, fastify.log);
queue.start();
const totalFeedLines = config.feedLines + config.cutFeedLines;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/bmp']);
const IMAGE_BODY_LIMIT = Math.max(config.maxChars * 4, MAX_IMAGE_BYTES * 2 + 1024);

fastify.register(fastifyStatic, {
  root: path.join(process.cwd(), 'public'),
  prefix: '/static/'
});

fastify.register(multipart, {
  limits: {
    fileSize: MAX_IMAGE_BYTES
  }
});

fastify.register(rateLimit, {
  global: false,
  max: config.rateLimitPerMinute,
  timeWindow: '1 minute'
});

fastify.addHook('onRequest', async (request, reply) => {
  if (config.requireApiKey && request.url.startsWith('/api')) {
    const provided = getApiKey(request);
    if (!provided || !isApiKeyValid(provided, config.apiKey as string)) {
      reply.code(401);
      return reply.send({ error: 'Unauthorized' });
    }
  }
  return undefined;
});

let statusCache: { checkedAt: number; value: { connected: boolean; details: Record<string, unknown> } } | null = null;
const STATUS_TTL_MS = 2000;

fastify.get('/healthz', async () => ({ ok: true }));

fastify.get('/readyz', async (_request, reply) => {
  const status = await getPrinterStatus();
  if (!status.connected) {
    reply.code(503);
    return { ready: false, status };
  }
  return { ready: true, status };
});

fastify.get('/', async (_request, reply) => {
  const lastJob = repo.latest();
  reply.type('text/html');
  return renderHome({ maxChars: config.maxChars, lastJob, requiresApiKey: config.requireApiKey });
});

fastify.get('/activity', async (request, reply) => {
  const { page, pageSize } = parsePagination(request);
  const data = repo.list(page, pageSize);
  reply.type('text/html');
  return renderActivity(data);
});

fastify.get('/control', async (_request, reply) => {
  reply.type('text/html');
  return renderControl({ requiresApiKey: config.requireApiKey });
});

fastify.get('/jobs/:id', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  if (!Number.isFinite(id)) {
    reply.code(400).send('Invalid job id');
    return;
  }
  const job = repo.getById(id);
  if (!job) {
    reply.code(404).send('Job not found');
    return;
  }
  reply.type('text/html');
  return renderJobDetail(job);
});

fastify.post(
  '/api/print',
  { config: { rateLimit: true }, bodyLimit: IMAGE_BODY_LIMIT },
  async (request, reply) => {
    let parsed: ParsedPrintRequest;
    try {
      parsed = request.isMultipart()
        ? await parseMultipartPrintRequest(request)
        : parseJsonPrintRequest(request.body as Record<string, unknown> | undefined);
    } catch (error) {
      reply.code(400);
      return reply.send({ error: error instanceof Error ? error.message : 'Invalid print request.' });
    }

    const includeText = parsed.includeText ?? Boolean(parsed.text && parsed.text.trim().length > 0);
    const includeImage = parsed.includeImage ?? Boolean(parsed.image);

    if (!includeText && !includeImage) {
      reply.code(400);
      return reply.send({ error: 'Provide text, an image, or both.' });
    }

    const sanitized = includeText ? sanitizeText(parsed.text ?? '') : '';
    if (includeText && sanitized.length === 0) {
      reply.code(400);
      return reply.send({ error: 'text must include printable characters' });
    }
    if (includeText && sanitized.length > config.maxChars) {
      reply.code(400);
      return reply.send({ error: `text exceeds ${config.maxChars} characters` });
    }

    if (includeImage && !parsed.image) {
      reply.code(400);
      return reply.send({ error: 'image is required when includeImage is true' });
    }

    if (includeImage && parsed.image && parsed.image.length > MAX_IMAGE_BYTES) {
      reply.code(400);
      return reply.send({ error: `image exceeds ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB limit` });
    }

    let jobId: number;
    try {
      jobId = await queueJob({
        text: includeText ? sanitized : '',
        image: includeImage ? parsed.image ?? null : null,
        imageMime: includeImage ? parsed.imageMime ?? null : null
      });
    } catch (error) {
      reply.code(400);
      return reply.send({
        error: error instanceof Error ? error.message : 'Failed to process print job.'
      });
    }

    fastify.log.info({ jobId }, 'job queued');
    queue.kick();

    reply.send({ jobId: String(jobId), status: 'queued' });
  }
);

fastify.post('/api/jobs/:id/reprint', { config: { rateLimit: true } }, async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  if (!Number.isFinite(id)) {
    reply.code(400).send({ error: 'Invalid job id' });
    return;
  }
  const job = repo.getById(id);
  if (!job) {
    reply.code(404).send({ error: 'Job not found' });
    return;
  }

  const sanitized = sanitizeText(job.text);
  if (job.text && sanitized.length === 0 && !job.image_data) {
    reply.code(400).send({ error: 'text must include printable characters' });
    return;
  }
  if (sanitized.length > config.maxChars) {
    reply.code(400).send({ error: `text exceeds ${config.maxChars} characters` });
    return;
  }

  let jobId: number;
  try {
    jobId = await queueJob({
      text: sanitized,
      image: job.image_data,
      imageMime: job.image_mime
    });
  } catch (error) {
    reply.code(400).send({ error: error instanceof Error ? error.message : 'Reprint failed.' });
    return;
  }
  fastify.log.info({ jobId, sourceJobId: id }, 'job reprint queued');
  queue.kick();

  reply.send({ jobId: String(jobId), status: 'queued' });
});

fastify.get('/api/status', { config: { rateLimit: true } }, async () => {
  const status = await getPrinterStatus();
  return { mode: config.printerMode, connected: status.connected, details: status.details };
});

fastify.get('/api/jobs', { config: { rateLimit: true } }, async (request) => {
  const { page, pageSize } = parsePagination(request);
  const data = repo.list(page, pageSize);

  return {
    items: data.items.map((job) => ({
      id: job.id,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      mode: job.mode,
      status: job.status,
      bytes: job.bytes,
      preview: job.preview,
      text: job.text,
      textHash: job.text_hash,
      hasImage: Boolean(job.image_data),
      imageMime: job.image_mime,
      imageHash: job.image_hash,
      error: job.error,
      errorSummary: job.error ? job.error.split('\n')[0] : null
    })),
    page: data.page,
    pageSize: data.pageSize,
    total: data.total
  };
});

fastify.post('/api/control/feed', { config: { rateLimit: true } }, async (_request, reply) => {
  try {
    return await printer.control('feed');
  } catch (error) {
    reply.code(502);
    return { confirmed: false, error: error instanceof Error ? error.message : String(error) };
  }
});

fastify.post('/api/control/cut', { config: { rateLimit: true } }, async (_request, reply) => {
  try {
    return await printer.control('cut');
  } catch (error) {
    reply.code(502);
    return { confirmed: false, error: error instanceof Error ? error.message : String(error) };
  }
});

fastify.post('/api/control/status', { config: { rateLimit: true } }, async (_request, reply) => {
  try {
    return await printer.control('status');
  } catch (error) {
    reply.code(502);
    return { confirmed: false, error: error instanceof Error ? error.message : String(error) };
  }
});

fastify.post('/api/control/status/print', { config: { rateLimit: true } }, async (_request, reply) => {
  try {
    const result = await printer.control('status');
    if (result.confirmed && result.status) {
      const report = formatStatusReport(result.status);
      const sanitized = sanitizeText(report);
      if (sanitized.length === 0) {
        return { ...result, error: 'Status report was empty and could not be printed.' };
      }
      if (sanitized.length > config.maxChars) {
        return { ...result, error: `Status report exceeds ${config.maxChars} characters and could not be printed.` };
      }
      const jobId = await queueJob({ text: sanitized });
      queue.kick();
      return { ...result, jobId: String(jobId) };
    }
    return result;
  } catch (error) {
    reply.code(502);
    return { confirmed: false, error: error instanceof Error ? error.message : String(error) };
  }
});

fastify.listen({ host: config.appHost, port: config.appPort }, (err) => {
  if (err) {
    fastify.log.error(err, 'failed to start server');
    process.exit(1);
  }
  fastify.log.info(`listening on http://${config.appHost}:${config.appPort}`);
});

function parsePagination(request: FastifyRequest): { page: number; pageSize: number } {
  const query = request.query as { page?: string; pageSize?: string };
  const page = Number.parseInt(query.page ?? '1', 10);
  const pageSize = Number.parseInt(query.pageSize ?? '20', 10);
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 20
  };
}

function getApiKey(request: FastifyRequest): string | undefined {
  const header = request.headers['x-api-key'];
  if (!header) {
    return undefined;
  }
  if (Array.isArray(header)) {
    return header[0];
  }
  return header;
}

function isApiKeyValid(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

interface ParsedPrintRequest {
  text?: string;
  includeText?: boolean;
  image?: Buffer;
  imageMime?: string;
  includeImage?: boolean;
}

async function queueJob(options: {
  text: string;
  image?: Buffer | null;
  imageMime?: string | null;
}): Promise<number> {
  const payload = await buildEscPosJobPayload({
    text: options.text.length > 0 ? options.text : undefined,
    image: options.image ?? undefined,
    feedLines: totalFeedLines,
    cutMode: config.cutMode
  });

  const hasImage = Boolean(options.image);
  const preview = buildJobPreview(options.text, hasImage, options.imageMime ?? undefined);

  return repo.insert({
    mode: config.printerMode,
    bytes: payload.length,
    preview,
    textHash: hashText(options.text),
    text: options.text,
    imageData: options.image ?? null,
    imageHash: hasImage ? hashBuffer(options.image as Buffer) : null,
    imageMime: options.imageMime ?? null
  });
}

function buildJobPreview(text: string, hasImage: boolean, imageMime?: string): string {
  const textPreview = previewText(text);
  if (!hasImage) {
    return textPreview;
  }
  const label = imageMime ? `Image (${imageMime.replace('image/', '')})` : 'Image attached';
  if (textPreview) {
    return `${textPreview}\n[${label}]`;
  }
  return `[${label}]`;
}

async function parseMultipartPrintRequest(request: FastifyRequest): Promise<ParsedPrintRequest> {
  const parts = request.parts();
  let text: string | undefined;
  let includeText: boolean | undefined;
  let includeImage: boolean | undefined;
  let image: Buffer | undefined;
  let imageMime: string | undefined;

  for await (const part of parts) {
    if (part.type === 'file') {
      if (part.fieldname !== 'image') {
        await part.toBuffer();
        continue;
      }
      if (!IMAGE_MIME_TYPES.has(part.mimetype)) {
        throw new Error('Unsupported image type. Use PNG, JPEG, GIF, or BMP.');
      }
      image = await part.toBuffer();
      imageMime = part.mimetype;
      continue;
    }

    if (part.fieldname === 'text') {
      text = typeof part.value === 'string' ? part.value : undefined;
    }
    if (part.fieldname === 'includeText') {
      includeText = parseBoolean(part.value);
    }
    if (part.fieldname === 'includeImage') {
      includeImage = parseBoolean(part.value);
    }
  }

  return { text, includeText, includeImage, image, imageMime };
}

function parseJsonPrintRequest(body: Record<string, unknown> | undefined): ParsedPrintRequest {
  if (!body) {
    throw new Error('Request body is required.');
  }
  const text = typeof body.text === 'string' ? body.text : undefined;
  const includeText = parseBoolean(body.includeText);
  const includeImage = parseBoolean(body.includeImage);

  const imageValue =
    typeof body.imageBase64 === 'string'
      ? body.imageBase64
      : typeof body.imageData === 'string'
          ? body.imageData
          : typeof body.image === 'string'
              ? body.image
              : undefined;

  const imageMimeHint = typeof body.imageMime === 'string' ? body.imageMime : undefined;

  if (imageValue) {
    const decoded = decodeBase64Image(imageValue, imageMimeHint);
    return { text, includeText, includeImage, image: decoded.buffer, imageMime: decoded.mime };
  }

  return { text, includeText, includeImage };
}

function parseBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function decodeBase64Image(value: string, mimeHint?: string): { buffer: Buffer; mime: string } {
  if (value.startsWith('data:')) {
    const match = value.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) {
      throw new Error('Invalid data URL for image.');
    }
    const mime = match[1];
    if (!IMAGE_MIME_TYPES.has(mime)) {
      throw new Error('Unsupported image type. Use PNG, JPEG, GIF, or BMP.');
    }
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0) {
      throw new Error('Image data was empty.');
    }
    return { buffer, mime };
  }

  if (!mimeHint) {
    throw new Error('imageMime is required when sending base64 image data.');
  }
  if (!IMAGE_MIME_TYPES.has(mimeHint)) {
    throw new Error('Unsupported image type. Use PNG, JPEG, GIF, or BMP.');
  }

  const buffer = Buffer.from(value, 'base64');
  if (buffer.length === 0) {
    throw new Error('Image data was empty.');
  }
  return { buffer, mime: mimeHint };
}

function formatStatusReport(status: StatusReport): string {
  const lines: string[] = [];
  lines.push('STATUS REPORT');
  lines.push(`Generated: ${formatIso()}`);
  lines.push(`Overall: ${status.ok ? 'OK' : 'ATTENTION'}`);
  lines.push('');

  for (const section of status.statuses) {
    lines.push(section.className);
    const entries = section.statuses.filter((entry) => entry.label !== 'Fixed');
    if (entries.length === 0) {
      lines.push('  [OK] All clear.');
    } else {
      for (const entry of entries) {
        const level = entry.status === 'warning' ? 'WARN' : entry.status.toUpperCase();
        lines.push(`  [${level}] ${entry.label}`);
      }
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

async function getPrinterStatus(): Promise<{ connected: boolean; details: Record<string, unknown> }> {
  const now = Date.now();
  if (statusCache && now - statusCache.checkedAt < STATUS_TTL_MS) {
    return statusCache.value;
  }
  const status = await printer.status();
  statusCache = { checkedAt: now, value: status };
  return status;
}
