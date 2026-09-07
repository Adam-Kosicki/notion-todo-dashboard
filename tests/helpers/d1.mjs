// Disposable, isolated SQLite test harness standing in for Cloudflare D1.
//
// D1 is SQLite (see drizzle.config.ts: dialect "sqlite"), and the generated
// migrations under drizzle/*.sql contain no D1-specific extensions (verified
// by reading them), so Node's built-in node:sqlite gives a real, transactional
// SQLite engine to test schema/migrations/constraints against without needing
// Miniflare or a Workers runtime. It is NOT a full Workers/D1 emulation
// (no D1-specific binding quirks, no Workers isolate) - it's a fast, isolated
// substitute good enough for schema, migration, and SQL-constraint testing.
//
// Every database here is either ":memory:" or a fresh temp file under the
// OS temp dir. Nothing in this module ever opens .wrangler/state - that file
// holds real local dev data and must never be touched by tests.
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DRIZZLE_DIR = path.join(PROJECT_ROOT, "drizzle");

/** Migration filenames in apply order (drizzle's own zero-padded numeric prefix sorts correctly). */
export function migrationFiles() {
  return readdirSync(DRIZZLE_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** Split one migration file into its individual statements (drizzle-kit's own breakpoint marker). */
export function statementsFor(fileName) {
  const sql = readFileSync(path.join(DRIZZLE_DIR, fileName), "utf8");
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/** Open a fresh, empty, disposable SQLite database. In-memory by default. */
export function openTestDb({ file } = {}) {
  return new DatabaseSync(file ?? ":memory:");
}

/**
 * Apply migration files, in order, to `db`. Pass `{ upTo: "0003_..." }` to stop
 * after a given file (inclusive) - used to simulate upgrading from a partially
 * migrated database. Pass `{ from: "0003_..." }` to start immediately AFTER a
 * given file (exclusive) - used to resume such a database forward. Combine
 * both to simulate "apply up to X, then later resume from X to the end."
 * Returns the list of files actually applied.
 */
export function applyMigrations(db, { upTo, from } = {}) {
  const files = migrationFiles();
  const startIndex = from ? files.indexOf(from) + 1 : 0;
  if (from && startIndex === 0) throw new Error(`Unknown migration file: ${from}`);
  const cutoffIndex = upTo ? files.indexOf(upTo) : files.length - 1;
  if (upTo && cutoffIndex === -1) throw new Error(`Unknown migration file: ${upTo}`);
  const target = files.slice(startIndex, cutoffIndex + 1);
  for (const file of target) {
    for (const statement of statementsFor(file)) {
      try {
        db.exec(statement);
      } catch (error) {
        throw new Error(`Migration ${file} failed on statement:\n${statement}\n\n${error.message}`, { cause: error });
      }
    }
  }
  return target;
}

/** A synthetic owner id and a few synthetic items/lists, shaped like real data but containing none of it. */
export function seedSyntheticOwner(db, ownerId) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO lists (owner_id, id, name, type, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(ownerId, `${ownerId}-list-groceries`, "Zz Test Groceries", "general", 0, now, now);

  const items = [
    { id: `${ownerId}-item-1`, title: "Zz Test buy milk", status: "Not started" },
    { id: `${ownerId}-item-2`, title: "Zz Test finish report", status: "Done" },
  ];
  for (const item of items) {
    db.prepare(
      `INSERT INTO items (owner_id, id, title, status, item_type, collection, updated_at)
       VALUES (?, ?, ?, ?, 'Task', ?, ?)`,
    ).run(ownerId, item.id, item.title, item.status, "Zz Test Groceries", now);
  }
  return { listId: `${ownerId}-list-groceries`, itemIds: items.map((item) => item.id) };
}

/** Snapshot every table's column list + row count - cheap way to compare two databases' shape. */
export function schemaSnapshot(db) {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((row) => row.name);
  const snapshot = {};
  for (const table of tables) {
    const columns = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((col) => `${col.name}:${col.type}`);
    const [{ count }] = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).all();
    snapshot[table] = { columns, rowCount: count };
  }
  return snapshot;
}

/** A fresh temp-file database path under the OS temp dir, plus a cleanup function. Use when a real file (not :memory:) is needed, e.g. to test backup/restore by copying the file. */
export function withTempDbFile() {
  const dir = mkdtempSync(path.join(tmpdir(), "burner-board-test-db-"));
  const file = path.join(dir, "test.sqlite");
  return {
    file,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
