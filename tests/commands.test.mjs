import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { createMigratedD1 } from "./helpers/d1.mjs";

register("./helpers/ts-loader.mjs", import.meta.url);
const { applyCommand } = await import("@/lib/server/commands");
const { setStorageMode, findItemRow, getBoardState } = await import("@/lib/server/repository");
const { getBoardSnapshot } = await import("@/lib/server/queries");

function envelope(action, payload, requestId = `req_${Math.random().toString(36).slice(2)}`) {
  return { apiVersion: 1, requestId, action, payload };
}

async function d1PrimaryOwner(ownerId = `zz-cmd-owner-${Math.random().toString(36).slice(2)}`) {
  const db = createMigratedD1();
  await setStorageMode(db, ownerId, "d1_primary");
  return { db, ownerId };
}

test("a legacy_notion owner is rejected (FORBIDDEN) - the command layer never runs for the real owner yet", async () => {
  const db = createMigratedD1();
  const ownerId = "zz-legacy-owner";
  // storage_mode defaults to legacy_notion - never call setStorageMode here.
  const result = await applyCommand(db, ownerId, envelope("items.create", { title: "Zz Test task" }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "FORBIDDEN");
});

test("unknown action is rejected without touching the database", async () => {
  const { db, ownerId } = await d1PrimaryOwner();
  const result = await applyCommand(db, ownerId, envelope("items.launch_rocket", {}));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "VALIDATION_FAILED");
});

test("malformed payload is rejected with details, not a thrown exception", async () => {
  const { db, ownerId } = await d1PrimaryOwner();
  const result = await applyCommand(db, ownerId, envelope("items.create", { title: "" }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "VALIDATION_FAILED");
});

test("items.create succeeds with no network access anywhere in the module (d1_primary invariant)", async () => {
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../lib/server/commands.ts", import.meta.url),
    "utf8",
  );
  assert.ok(!/\bfetch\s*\(/.test(source), "commands.ts must never call fetch - that's the whole d1_primary guarantee");

  const { db, ownerId } = await d1PrimaryOwner();
  const result = await applyCommand(db, ownerId, envelope("items.create", { title: "Zz Test buy milk" }));
  assert.equal(result.ok, true);
  assert.equal(result.result.title, "Zz Test buy milk");
  assert.equal(result.result.version, 1);
  assert.equal(result.boardRevision, 1);
  assert.deepEqual(result.changedItemIds, [result.result.id]);
});

test("items.create succeeds identically whether or not the owner has a connected Notion integration row - it's never queried", async () => {
  const { db, ownerId } = await d1PrimaryOwner();
  await db
    .prepare("INSERT INTO integrations (owner_id, provider, ciphertext, iv) VALUES (?, 'notion', 'fake-ciphertext', 'fake-iv')")
    .bind(ownerId)
    .run();
  const result = await applyCommand(db, ownerId, envelope("items.create", { title: "Zz Test connected owner" }));
  assert.equal(result.ok, true);
  assert.equal(result.result.title, "Zz Test connected owner");
});

test("full lifecycle: create -> update -> complete -> reopen -> delete -> restore, versions increment each time", async () => {
  const { db, ownerId } = await d1PrimaryOwner();
  const created = await applyCommand(db, ownerId, envelope("items.create", { title: "Zz Test lifecycle" }));
  const id = created.result.id;
  assert.equal(created.result.version, 1);

  const updated = await applyCommand(db, ownerId, envelope("items.update", { id, expectedVersion: 1, changes: { priority: 5 } }));
  assert.equal(updated.ok, true);
  assert.equal(updated.result.priority, 5);
  assert.equal(updated.result.version, 2);

  const completed = await applyCommand(db, ownerId, envelope("items.complete", { id, expectedVersion: 2 }));
  assert.equal(completed.result.status, "Done");
  assert.ok(completed.result.completedAt);
  assert.equal(completed.result.version, 3);

  const reopened = await applyCommand(db, ownerId, envelope("items.reopen", { id, expectedVersion: 3 }));
  assert.equal(reopened.result.status, "Not started");
  assert.equal(reopened.result.completedAt, null);
  assert.equal(reopened.result.version, 4);

  const deleted = await applyCommand(db, ownerId, envelope("items.delete", { id, expectedVersion: 4 }));
  assert.equal(deleted.ok, true);
  assert.ok(deleted.result.deletedAt);
  const afterDelete = await getBoardSnapshot(db, ownerId);
  assert.ok(!afterDelete.items.some((item) => item.id === id), "a deleted item must not appear in the live snapshot");
  const rawRow = await findItemRow(db, ownerId, id);
  assert.ok(rawRow.deleted_at, "tombstone: the row itself still exists, just marked deleted");

  const restored = await applyCommand(db, ownerId, envelope("items.restore", { id, expectedVersion: 5 }));
  assert.equal(restored.ok, true);
  assert.equal(restored.result.deletedAt, null);
  const afterRestore = await getBoardSnapshot(db, ownerId);
  assert.ok(afterRestore.items.some((item) => item.id === id), "a restored item must reappear in the live snapshot");
});

test("stale writes conflict: an outdated expectedVersion is rejected, not silently applied", async () => {
  const { db, ownerId } = await d1PrimaryOwner();
  const created = await applyCommand(db, ownerId, envelope("items.create", { title: "Zz Test conflict" }));
  const id = created.result.id;
  await applyCommand(db, ownerId, envelope("items.update", { id, expectedVersion: 1, changes: { priority: 3 } }));

  const stale = await applyCommand(db, ownerId, envelope("items.update", { id, expectedVersion: 1, changes: { priority: 9 } }));
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "CONFLICT");

  const row = await findItemRow(db, ownerId, id);
  assert.equal(row.priority, 3, "the stale write must not have applied");
});

test("a nonexistent item id is NOT_FOUND, not CONFLICT", async () => {
  const { db, ownerId } = await d1PrimaryOwner();
  const result = await applyCommand(db, ownerId, envelope("items.update", { id: "item_does_not_exist", expectedVersion: 1, changes: { priority: 1 } }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NOT_FOUND");
});

test("owner isolation: one owner's request can never see or modify another owner's item", async () => {
  const ownerA = `zz-owner-a-${Math.random().toString(36).slice(2)}`;
  const ownerB = `zz-owner-b-${Math.random().toString(36).slice(2)}`;
  const db = createMigratedD1();
  await setStorageMode(db, ownerA, "d1_primary");
  await setStorageMode(db, ownerB, "d1_primary");
  const created = await applyCommand(db, ownerA, envelope("items.create", { title: "Zz Test owner A's item" }));
  const id = created.result.id;

  const crossOwnerRead = await applyCommand(db, ownerB, envelope("items.update", { id, expectedVersion: 1, changes: { priority: 1 } }));
  assert.equal(crossOwnerRead.ok, false);
  assert.equal(crossOwnerRead.error.code, "NOT_FOUND");

  const stateA = await getBoardState(db, ownerA);
  const stateB = await getBoardState(db, ownerB);
  assert.equal(stateA.revision, 1, "owner A's revision reflects their own command");
  assert.equal(stateB.revision, 0, "owner B's revision must be untouched by owner A's activity");
});

test("duplicate request replay: same request ID + same payload returns the identical result, no duplicate activity event", async () => {
  const { db, ownerId } = await d1PrimaryOwner();
  const requestId = "req_fixed_replay_test";
  const first = await applyCommand(db, ownerId, envelope("items.create", { title: "Zz Test replay" }, requestId));
  const second = await applyCommand(db, ownerId, envelope("items.create", { title: "Zz Test replay" }, requestId));
  assert.deepEqual(first, second, "a byte-identical replay must return the exact same result, not run twice");

  const events = await db.prepare("SELECT COUNT(*) AS count FROM activity_events WHERE owner_id = ? AND request_id = ?").bind(ownerId, requestId).first();
  assert.equal(events.count, 1, "exactly one activity event, not two");
  const state = await getBoardState(db, ownerId);
  assert.equal(state.revision, 1, "the board revision must not have advanced a second time");
});

test("duplicate request ID with a DIFFERENT payload is a conflict, not silently accepted", async () => {
  const { db, ownerId } = await d1PrimaryOwner();
  const requestId = "req_fixed_conflict_test";
  await applyCommand(db, ownerId, envelope("items.create", { title: "Zz Test original" }, requestId));
  const result = await applyCommand(db, ownerId, envelope("items.create", { title: "Zz Test different" }, requestId));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "CONFLICT");
});

test("expectedBoardRevision, when supplied, is enforced before any mutation runs", async () => {
  const { db, ownerId } = await d1PrimaryOwner();
  await applyCommand(db, ownerId, envelope("items.create", { title: "Zz Test bump revision" }));
  const stale = await applyCommand(db, ownerId, { apiVersion: 1, requestId: "req_stale_board_rev", expectedBoardRevision: 0, action: "items.create", payload: { title: "Zz Test should not create" } });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "CONFLICT");
  const snapshot = await getBoardSnapshot(db, ownerId);
  assert.equal(snapshot.items.length, 1, "the rejected command must not have created a second item");
});

test("list rename preserves membership for free (items reference list_id, never the name)", async () => {
  const { db, ownerId } = await d1PrimaryOwner();
  const list = await applyCommand(db, ownerId, envelope("lists.create", { name: "Zz Test Original Name" }));
  const listId = list.result.id;
  const item = await applyCommand(db, ownerId, envelope("items.create", { title: "Zz Test in a list", listId }));

  const renamed = await applyCommand(db, ownerId, envelope("lists.update", { id: listId, changes: { name: "Zz Test Renamed" } }));
  assert.equal(renamed.ok, true);
  assert.equal(renamed.result.name, "Zz Test Renamed");

  const row = await findItemRow(db, ownerId, item.result.id);
  assert.equal(row.list_id, listId, "membership survives the rename untouched");
});

test("lists.update rejects renaming to a name that already exists for this owner", async () => {
  const { db, ownerId } = await d1PrimaryOwner();
  await applyCommand(db, ownerId, envelope("lists.create", { name: "Zz Test Existing" }));
  const other = await applyCommand(db, ownerId, envelope("lists.create", { name: "Zz Test Other" }));
  const result = await applyCommand(db, ownerId, envelope("lists.update", { id: other.result.id, changes: { name: "Zz Test Existing" } }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "VALIDATION_FAILED");
});

test("lists.delete detaches member items atomically rather than deleting them", async () => {
  const { db, ownerId } = await d1PrimaryOwner();
  const list = await applyCommand(db, ownerId, envelope("lists.create", { name: "Zz Test To Delete" }));
  const listId = list.result.id;
  const item = await applyCommand(db, ownerId, envelope("items.create", { title: "Zz Test detached item", listId }));

  const deleted = await applyCommand(db, ownerId, envelope("lists.delete", { id: listId }));
  assert.equal(deleted.ok, true);
  assert.equal(deleted.result.detachedCount, 1);

  const row = await findItemRow(db, ownerId, item.result.id);
  assert.equal(row.list_id, null, "the item survives, just detached");
  assert.equal(row.deleted_at, null, "detaching is not deleting");
});

test("items.move validates the target list actually exists for this owner", async () => {
  const { db, ownerId } = await d1PrimaryOwner();
  const created = await applyCommand(db, ownerId, envelope("items.create", { title: "Zz Test move target check" }));
  const result = await applyCommand(db, ownerId, envelope("items.move", { id: created.result.id, expectedVersion: 1, listId: "list_does_not_exist" }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "VALIDATION_FAILED");
});

test("deleting an already-deleted item is a CONFLICT, and restoring a not-deleted item is a CONFLICT", async () => {
  const { db, ownerId } = await d1PrimaryOwner();
  const created = await applyCommand(db, ownerId, envelope("items.create", { title: "Zz Test double delete" }));
  const id = created.result.id;

  const notDeletedYet = await applyCommand(db, ownerId, envelope("items.restore", { id, expectedVersion: 1 }));
  assert.equal(notDeletedYet.ok, false);
  assert.equal(notDeletedYet.error.code, "CONFLICT");

  await applyCommand(db, ownerId, envelope("items.delete", { id, expectedVersion: 1 }));
  const doubleDelete = await applyCommand(db, ownerId, envelope("items.delete", { id, expectedVersion: 2 }));
  assert.equal(doubleDelete.ok, false);
  assert.equal(doubleDelete.error.code, "CONFLICT");
});
