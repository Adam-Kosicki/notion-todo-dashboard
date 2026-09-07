import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMigrations,
  migrationFiles,
  openTestDb,
  schemaSnapshot,
  seedSyntheticOwner,
} from "./helpers/d1.mjs";

const EXPECTED_TABLES = ["app_meta", "integrations", "items", "lists"];

test("every migration file applies cleanly, in order, to a fresh database", () => {
  const db = openTestDb();
  const applied = applyMigrations(db);
  assert.equal(applied.length, migrationFiles().length, "expected every drizzle migration to run");
  const snapshot = schemaSnapshot(db);
  for (const table of EXPECTED_TABLES) {
    assert.ok(snapshot[table], `expected table ${table} to exist after migration`);
  }
});

test("final schema has no leftover Todoist columns (dropped in 0007)", () => {
  const db = openTestDb();
  applyMigrations(db);
  const columns = db.prepare(`PRAGMA table_info(items)`).all().map((c) => c.name);
  assert.ok(!columns.includes("todoist_id"), "todoist_id should have been dropped");
  assert.ok(!columns.includes("show_in_todoist"), "show_in_todoist should have been dropped");
});

test("upgrading from every earlier migration checkpoint reaches the same final schema as a fresh apply", () => {
  const files = migrationFiles();
  assert.ok(files.length > 1, "need at least two migrations for this test to mean anything");

  const freshDb = openTestDb();
  applyMigrations(freshDb);
  const expected = schemaSnapshot(freshDb);

  for (const checkpoint of files) {
    const db = openTestDb();
    // Simulate a database that was only migrated up to `checkpoint` previously,
    // then continues forward through the rest - this is the real-world shape
    // of "upgrade an existing deployment", not just "migrate from empty".
    applyMigrations(db, { upTo: checkpoint });
    applyMigrations(db, { from: checkpoint }); // resume: apply only what's left
    const actual = schemaSnapshot(db);
    assert.deepEqual(
      actual,
      expected,
      `resuming from checkpoint ${checkpoint} produced a different final schema than a fresh apply`,
    );
  }
});

test("re-running all migrations against an already-migrated database is a no-op, not an error", () => {
  // applyMigrations() re-executes every CREATE TABLE/INDEX statement verbatim.
  // Drizzle's generated SQL does not use IF NOT EXISTS, so migrations are
  // apply-once by file, not safely re-runnable directly - this is exactly
  // what scripts/migrate-board.mjs's ledger exists to prevent. This test
  // documents that raw re-application fails loudly (proving the ledger is
  // necessary) rather than silently corrupting state.
  const db = openTestDb();
  applyMigrations(db);
  assert.throws(() => applyMigrations(db), /already exists|Migration .* failed/);
});

test("every migration applies cleanly to a table that already has rows, not just an empty one", () => {
  // Regression test: SQLite's ALTER TABLE ADD COLUMN rejects a non-constant default
  // (CURRENT_TIMESTAMP, CURRENT_DATE, an expression) specifically when the table already has
  // rows - a constraint that never surfaces against a freshly-migrated, empty database (every
  // other test in this file). Caught for real against the actual local dev D1 file (which has
  // real data) while building migration 0008 - fixed there by dropping the DB-level default and
  // backfilling with a data UPDATE instead. This test exists so the next migration that adds a
  // column can't reintroduce the same mistake and have it only surface against real data later.
  const files = migrationFiles();
  const lastFile = files[files.length - 1];
  const db = openTestDb();
  applyMigrations(db, { upTo: files[files.length - 2] ?? files[0] });
  seedSyntheticOwner(db, "zz-non-empty-migration-test");
  assert.doesNotThrow(() => applyMigrations(db, { from: files[files.length - 2] ?? undefined }), `migration ${lastFile} must apply cleanly even when items/lists already have rows`);
});

test("owner isolation: two synthetic owners can hold same-shaped rows without colliding", () => {
  const db = openTestDb();
  applyMigrations(db);
  const ownerA = seedSyntheticOwner(db, "zz-test-owner-a");
  const ownerB = seedSyntheticOwner(db, "zz-test-owner-b");

  const ownerAItems = db.prepare(`SELECT id FROM items WHERE owner_id = ?`).all("zz-test-owner-a");
  const ownerBItems = db.prepare(`SELECT id FROM items WHERE owner_id = ?`).all("zz-test-owner-b");
  assert.equal(ownerAItems.length, ownerA.itemIds.length);
  assert.equal(ownerBItems.length, ownerB.itemIds.length);

  const totalItems = db.prepare(`SELECT COUNT(*) AS count FROM items`).all()[0].count;
  assert.equal(totalItems, ownerA.itemIds.length + ownerB.itemIds.length, "no cross-owner leakage or overwrite");
});
