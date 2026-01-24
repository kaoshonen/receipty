import 'dotenv/config';
import path from 'node:path';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { FastifyRequest } from 'fastify';
import { loadConfig } from './config';
import { openDb } from './db';
import { createJobRepository } from './jobs';
import { JobQueue } from './queue';
import { createPrinter } from './printer';
import { buildEscPosPayload } from './escpos';
import { formatIso, hashText, previewText, sanitizeText } from './utils';
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

fastify.register(fastifyStatic, {
  root: path.join(process.cwd(), 'public'),
  prefix: '/static/'
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

fastify.post('/api/print', { config: { rateLimit: true } }, async (request, reply) => {
  const body = request.body as { text?: unknown } | undefined;
  const rawText = typeof body?.text === 'string' ? body.text : undefined;
  if (!rawText) {
    reply.code(400).send({ error: 'text is required' });
    return;
  }

  const sanitized = sanitizeText(rawText);
  if (sanitized.length === 0) {
    reply.code(400).send({ error: 'text must include printable characters' });
    return;
  }
  if (sanitized.length > config.maxChars) {
    reply.code(400).send({ error: `text exceeds ${config.maxChars} characters` });
    return;
  }

  const jobId = queueSanitizedJob(sanitized);

  fastify.log.info({ jobId }, 'job queued');
  queue.kick();

  reply.send({ jobId: String(jobId), status: 'queued' });
});

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
  if (sanitized.length === 0) {
    reply.code(400).send({ error: 'text must include printable characters' });
    return;
  }
  if (sanitized.length > config.maxChars) {
    reply.code(400).send({ error: `text exceeds ${config.maxChars} characters` });
    return;
  }

  const jobId = queueSanitizedJob(sanitized);
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
      const jobId = queueSanitizedJob(sanitized);
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

function queueSanitizedJob(sanitized: string): number {
  const payload = buildEscPosPayload(sanitized, totalFeedLines, config.cutMode);
  return repo.insert({
    mode: config.printerMode,
    bytes: payload.length,
    preview: previewText(sanitized),
    textHash: hashText(sanitized),
    text: sanitized
  });
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
