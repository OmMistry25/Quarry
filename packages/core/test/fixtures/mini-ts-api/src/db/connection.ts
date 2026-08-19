import Database from 'better-sqlite3';

let db: Database.Database | undefined;

export function openDatabase(): Database.Database {
  if (db) return db;

  db = new Database(process.env.DATABASE_PATH ?? './inventory.db');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      sku        TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      warehouse  TEXT NOT NULL,
      quantity   INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS shipments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      sku        TEXT NOT NULL,
      quantity   INTEGER NOT NULL,
      shipped_at TEXT NOT NULL
    );
  `);

  return db;
}

export function closeDatabase(): void {
  db?.close();
  db = undefined;
}
