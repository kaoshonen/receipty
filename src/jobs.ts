import type { Database } from 'better-sqlite3';
import { formatIso } from './utils';

export type JobStatus = 'queued' | 'printing' | 'succeeded' | 'failed';

export interface JobRow {
  id: number;
  created_at: string;
  updated_at: string;
  mode: string;
  status: JobStatus;
  bytes: number;
  preview: string;
  text_hash: string;
  text: string;
  image_data: Buffer | null;
  image_hash: string | null;
  image_mime: string | null;
  error: string | null;
}

export interface JobListResult {
  items: JobRow[];
  page: number;
  pageSize: number;
  total: number;
}

export interface JobInsert {
  mode: string;
  bytes: number;
  preview: string;
  textHash: string;
  text: string;
  imageData?: Buffer | null;
  imageHash?: string | null;
  imageMime?: string | null;
}

export interface JobRepository {
  insert: (job: JobInsert) => number;
  nextQueued: () => JobRow | undefined;
  updateStatus: (id: number, status: JobStatus, error?: string | null) => void;
  list: (page: number, pageSize: number) => JobListResult;
  getById: (id: number) => JobRow | undefined;
  latest: () => JobRow | undefined;
}

export function createJobRepository(db: Database): JobRepository {
  const insertStmt = db.prepare(
    'INSERT INTO jobs (created_at, updated_at, mode, status, bytes, preview, text_hash, text, image_data, image_hash, image_mime, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)'
  );
  const nextQueuedStmt = db.prepare(
    'SELECT * FROM jobs WHERE status = ? ORDER BY id ASC LIMIT 1'
  );
  const updateStatusStmt = db.prepare(
    'UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?'
  );
  const listStmt = db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ? OFFSET ?');
  const countStmt = db.prepare('SELECT COUNT(1) as total FROM jobs');
  const byIdStmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
  const latestStmt = db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT 1');

  return {
    insert: (job) => {
      const now = formatIso();
      const result = insertStmt.run(
        now,
        now,
        job.mode,
        'queued',
        job.bytes,
        job.preview,
        job.textHash,
        job.text,
        job.imageData ?? null,
        job.imageHash ?? null,
        job.imageMime ?? null
      );
      return Number(result.lastInsertRowid);
    },
    nextQueued: () => nextQueuedStmt.get('queued') as JobRow | undefined,
    updateStatus: (id, status, error = null) => {
      updateStatusStmt.run(status, error, formatIso(), id);
    },
    list: (page, pageSize) => {
      const safePage = Math.max(1, page);
      const safeSize = Math.max(1, pageSize);
      const offset = (safePage - 1) * safeSize;
      const items = listStmt.all(safeSize, offset) as JobRow[];
      const total = (countStmt.get() as { total: number }).total;
      return { items, page: safePage, pageSize: safeSize, total };
    },
    getById: (id) => byIdStmt.get(id) as JobRow | undefined,
    latest: () => latestStmt.get() as JobRow | undefined
  };
}
