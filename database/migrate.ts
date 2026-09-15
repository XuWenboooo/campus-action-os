import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const migrationDirectory = resolve(projectRoot, 'database/migrations');

export function defaultDatabasePath(): string {
  return process.env.DATABASE_PATH ?? resolve(projectRoot, 'data/campus-action-os.sqlite');
}

export function migrateDatabase(databasePath = defaultDatabasePath()): DatabaseSync {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true, timeout: 5000 });
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;',
  );
  const applied = new Set(
    (
      db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
        version: number;
      }>
    ).map((row) => row.version),
  );
  const files = readdirSync(migrationDirectory)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  for (const file of files) {
    const version = Number(file.slice(0, file.indexOf('_')));
    if (applied.has(version)) continue;
    const sql = readFileSync(resolve(migrationDirectory, file), 'utf8');
    const temporarilyDisableForeignKeys = file === '008_allow_jpeg.sql';
    if (temporarilyDisableForeignKeys) db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        version,
        file,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
      if (temporarilyDisableForeignKeys) {
        db.exec('PRAGMA foreign_keys = ON;');
        db.exec('PRAGMA foreign_key_check;');
      }
    } catch (error) {
      db.exec('ROLLBACK');
      if (temporarilyDisableForeignKeys) db.exec('PRAGMA foreign_keys = ON;');
      db.close();
      throw error;
    }
  }
  return db;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const db = migrateDatabase();
  const tableCount = (
    db
      .prepare(
        "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .get() as { count: number }
  ).count;
  console.log(`SQLite migration passed: ${defaultDatabasePath()} (${tableCount} tables)`);
  db.close();
}
