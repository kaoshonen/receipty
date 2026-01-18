import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { formatIso } from './utils';

export function openDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

function runMigrations(db: Database.Database): void {
  const migrationsDir = path.join(process.cwd(), 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    return;
  }

  db.exec('CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const appliedRows = db.prepare('SELECT id FROM migrations').all() as Array<{ id: string }>;
  const applied = new Set<string>(appliedRows.map((row) => row.id));

  const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO migrations (id, applied_at) VALUES (?, ?)').run(file, formatIso());
  }
}
