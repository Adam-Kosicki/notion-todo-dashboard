#!/usr/bin/env node
// Migration runner for the D1/SQLite schema under drizzle/*.sql.
//
// Replaces ad-hoc `sqlite3 "$DB" < migration.sql` with an explicit,
// resumable, ledgered process. There is deliberately NO default database
// target anywhere in this file - every invocation must name one with --db.
// --apply is the only mode that writes anything; --dry-run and --check
// never mutate the target database.
//
// Usage:
//   node scripts/migrate-board.mjs --db <path-to-sqlite-file> --mode dry-run
//   node scripts/migrate-board.mjs --db <path-to-sqlite-file> --mode check
//   node scripts/migrate-board.mjs --db <path-to-sqlite-file> --mode apply
//   node scripts/migrate-board.mjs --db <path-to-sqlite-file> --mode seed --up-to <file>
//
// `seed` is for adopting this ledger on a database that was already migrated by hand before
// this tool existed (e.g. this repo's own local dev D1, migrated via `sqlite3 "$DB" <
// migration.sql` up through 0007 before scripts/migrate-board.mjs existed): it marks every
// migration up to and including --up-to as applied WITHOUT running their SQL. Refuses to run
// if the ledger already has entries (adopt once, on a genuinely pre-existing database) or if
// --up-to isn't the actual next unrecorded migration in sequence.
//
// For production D1, this script does not talk to Cloudflare directly today -
// export the D1 file (or use `wrangler d1 execute --config wrangler.deploy.jsonc`)
// to get a local .sqlite copy, run this against that copy for dry-run/check,
// then apply the same drizzle/*.sql files remotely the same way this repo
// already documents in CLAUDE.md/AGENTS.md. See docs/operations/data-recovery.md.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DRIZZLE_DIR = path.join(PROJECT_ROOT, "drizzle");
const LEDGER_TABLE = "_migrations_ledger";

function usageAndExit(message) {
  if (message) console.error(message);
  console.error(
    "usage: node scripts/migrate-board.mjs --db <path> --mode dry-run|check|apply",
  );
  process.exit(64);
}

function parseArgs(argv) {
  const args = { db: null, mode: null, upTo: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--db") args.db = argv[++i];
    else if (argv[i] === "--mode") args.mode = argv[++i];
    else if (argv[i] === "--up-to") args.upTo = argv[++i];
  }
  return args;
}

function migrationFiles() {
  return readdirSync(DRIZZLE_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function statementsFor(fileName) {
  const sql = readFileSync(path.join(DRIZZLE_DIR, fileName), "utf8");
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function ledgerExists(db) {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(LEDGER_TABLE);
  return Boolean(row);
}

function appliedMigrations(db) {
  if (!ledgerExists(db)) return [];
  return db
    .prepare(`SELECT id FROM ${LEDGER_TABLE} ORDER BY id`)
    .all()
    .map((row) => row.id);
}

function pendingMigrations(db) {
  const applied = new Set(appliedMigrations(db));
  return migrationFiles().filter((file) => !applied.has(file));
}

function ensureLedgerTable(db) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
  );
}

function applyOneMigration(db, file) {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const statement of statementsFor(file)) {
      db.exec(statement);
    }
    db.prepare(`INSERT INTO ${LEDGER_TABLE} (id, applied_at) VALUES (?, ?)`).run(
      file,
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw new Error(`Migration ${file} failed, rolled back: ${error.message}`, { cause: error });
  }
}

function detectLedgerDrift(db) {
  const files = new Set(migrationFiles());
  return appliedMigrations(db).filter((id) => !files.has(id));
}

function main() {
  const { db: dbPath, mode, upTo } = parseArgs(process.argv.slice(2));
  if (!dbPath) usageAndExit("--db is required; there is no default target.");
  if (!mode || !["dry-run", "check", "apply", "seed"].includes(mode)) {
    usageAndExit(`--mode must be one of dry-run, check, apply, seed (got ${mode ?? "nothing"}).`);
  }
  if (mode === "seed" && !upTo) usageAndExit("--mode seed requires --up-to <file>.");

  const dbExisted = existsSync(dbPath);
  const db = new DatabaseSync(dbPath);

  try {
    if (mode === "dry-run") {
      const pending = pendingMigrations(db);
      console.log(`Database: ${dbPath}${dbExisted ? "" : " (new file)"}`);
      console.log(`Already applied: ${appliedMigrations(db).length}`);
      console.log(`Pending (${pending.length}):`);
      for (const file of pending) {
        console.log(`  - ${file} (${statementsFor(file).length} statements)`);
      }
      console.log("Dry run only - no changes were made.");
      return;
    }

    if (mode === "check") {
      const drift = detectLedgerDrift(db);
      const pending = pendingMigrations(db);
      if (drift.length > 0) {
        console.error(`Ledger drift: ${drift.length} applied migration(s) no longer exist on disk:`);
        for (const id of drift) console.error(`  - ${id}`);
        process.exitCode = 1;
      }
      if (pending.length > 0) {
        console.log(`${pending.length} pending migration(s):`);
        for (const file of pending) console.log(`  - ${file}`);
        process.exitCode = process.exitCode || 1;
      }
      if (drift.length === 0 && pending.length === 0) {
        console.log("Up to date. No drift, nothing pending.");
      }
      return;
    }

    if (mode === "apply") {
      ensureLedgerTable(db);
      const pending = pendingMigrations(db);
      if (pending.length === 0) {
        console.log("Nothing to apply - already up to date.");
        return;
      }
      console.log(`Applying ${pending.length} migration(s) to ${dbPath}...`);
      for (const file of pending) {
        applyOneMigration(db, file);
        console.log(`  applied ${file}`);
      }
      console.log("Done.");
    }

    if (mode === "seed") {
      if (appliedMigrations(db).length > 0) {
        console.error("Refusing to seed: the ledger already has entries. `seed` is only for adopting a never-ledgered database.");
        process.exitCode = 1;
        return;
      }
      const files = migrationFiles();
      const cutoffIndex = files.indexOf(upTo);
      if (cutoffIndex === -1) {
        console.error(`--up-to ${upTo} is not a known migration file.`);
        process.exitCode = 1;
        return;
      }
      ensureLedgerTable(db);
      const toSeed = files.slice(0, cutoffIndex + 1);
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const file of toSeed) {
          db.prepare(`INSERT INTO ${LEDGER_TABLE} (id, applied_at) VALUES (?, ?)`).run(file, now);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      console.log(`Seeded ${toSeed.length} migration(s) as already-applied, without running their SQL:`);
      for (const file of toSeed) console.log(`  - ${file}`);
      console.log(`Remaining pending: ${pendingMigrations(db).length}`);
    }
  } finally {
    db.close();
  }
}

main();
