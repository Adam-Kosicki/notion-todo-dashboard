// Phase 3: focus.set/week.commit/week.withdraw/week.close through the real applyCommand
// dispatcher, exercised for a legacy_notion owner specifically - the point of this file is to
// prove the scoped d1_primary gate (lib/server/commands.ts's requiresD1Primary) actually works:
// focus./week. commands must succeed for a legacy_notion owner while items./lists. commands
// stay forbidden, exactly as they did before Phase 3.
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { createMigratedD1 } from "./helpers/d1.mjs";

register("./helpers/ts-loader.mjs", import.meta.url);
const { applyCommand } = await import("@/lib/server/commands");
const { createPlanningWeek, findPlanningWeek, listFocusItems } = await import("@/lib/server/repository");

function envelope(action, payload, requestId = `req_${Math.random().toString(36).slice(2)}`) {
  return { apiVersion: 1, requestId, action, payload };
}

async function legacyOwnerWithItem(ownerId = `zz-focus-owner-${Math.random().toString(36).slice(2)}`) {
  const db = createMigratedD1();
  // storage_mode defaults to legacy_notion - never call setStorageMode, that's the point.
  await db
    .prepare(
      `INSERT INTO items (owner_id, id, title, status, item_type, version, review_state, recorded_at, updated_at, raw_json)
       VALUES (?, 'zz-item-1', 'Zz Test focus item', 'Not started', 'Task', 1, 'needs_review', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '{}')`,
    )
    .bind(ownerId)
    .run();
  return { db, ownerId };
}

test("focus.set works for a legacy_notion owner (Focus has no Notion equivalent, so it's exempt)", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  const result = await applyCommand(db, ownerId, envelope("focus.set", { itemId: "zz-item-1", focused: true }));
  assert.equal(result.ok, true);
  const focused = await listFocusItems(db, ownerId);
  assert.equal(focused.length, 1);
  assert.equal(focused[0].item_id, "zz-item-1");
});

test("focus.set with focused:false removes the focus row, and is idempotent both ways", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  await applyCommand(db, ownerId, envelope("focus.set", { itemId: "zz-item-1", focused: true }));
  await applyCommand(db, ownerId, envelope("focus.set", { itemId: "zz-item-1", focused: true })); // re-set, should not error
  const removeResult = await applyCommand(db, ownerId, envelope("focus.set", { itemId: "zz-item-1", focused: false }));
  assert.equal(removeResult.ok, true);
  assert.deepEqual(await listFocusItems(db, ownerId), []);
  const removeAgain = await applyCommand(db, ownerId, envelope("focus.set", { itemId: "zz-item-1", focused: false }));
  assert.equal(removeAgain.ok, true, "removing an already-absent focus item is a no-op, not an error");
});

test("focus.set rejects an itemId that does not exist", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  const result = await applyCommand(db, ownerId, envelope("focus.set", { itemId: "zz-nonexistent", focused: true }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "VALIDATION_FAILED");
});

test("items.create still stays FORBIDDEN for a legacy_notion owner - the scoped gate didn't accidentally widen", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  const result = await applyCommand(db, ownerId, envelope("items.create", { title: "Zz Test task" }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "FORBIDDEN");
});

test("week.commit/withdraw/close lifecycle works for a legacy_notion owner and freezes a report", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  await createPlanningWeek(db, ownerId, "zz-week-1", "2026-09-07", "America/Chicago");

  const commitResult = await applyCommand(db, ownerId, envelope("week.commit", { weekId: "zz-week-1", itemId: "zz-item-1" }));
  assert.equal(commitResult.ok, true);

  // Idempotent re-commit: no error, no duplicate row (PK would reject a second INSERT if this
  // handler didn't short-circuit first).
  const recommit = await applyCommand(db, ownerId, envelope("week.commit", { weekId: "zz-week-1", itemId: "zz-item-1" }));
  assert.equal(recommit.ok, true);

  // items.complete is still gated (legacy_notion, proven by the test above), so mark the item
  // complete directly via the D1 harness instead - this test is about week.close's stats
  // freezing, not item mutation gating.
  await db.prepare("UPDATE items SET status = 'Done', completed_at = CURRENT_TIMESTAMP WHERE owner_id = ? AND id = ?").bind(ownerId, "zz-item-1").run();
  await db
    .prepare(
      "INSERT INTO activity_events (id, owner_id, entity_id, actor_kind, event_type, request_id, before_json, after_json) VALUES ('zz-evt-1', ?, 'zz-item-1', 'owner', 'items.complete', 'zz-req', NULL, NULL)",
    )
    .bind(ownerId)
    .run();

  const closeResult = await applyCommand(db, ownerId, envelope("week.close", { weekId: "zz-week-1" }));
  assert.equal(closeResult.ok, true);
  assert.equal(closeResult.result.status, "computed");
  assert.equal(closeResult.result.completed, 1);

  const week = await findPlanningWeek(db, ownerId, "zz-week-1");
  assert.equal(week.status, "closed");
  assert.ok(week.report_json, "the frozen snapshot must be persisted");

  const commitAfterClose = await applyCommand(db, ownerId, envelope("week.commit", { weekId: "zz-week-1", itemId: "zz-item-1" }));
  assert.equal(commitAfterClose.ok, false);
  assert.equal(commitAfterClose.error.code, "CONFLICT", "a closed week must reject new commitments");

  const recloseResult = await applyCommand(db, ownerId, envelope("week.close", { weekId: "zz-week-1" }));
  assert.equal(recloseResult.ok, true);
  assert.deepEqual(recloseResult.result, closeResult.result, "re-closing an already-closed week must return the exact frozen snapshot, never recompute it");
});

test("week.withdraw keeps the commitment row (for the denominator) and marks it withdrawn", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  await createPlanningWeek(db, ownerId, "zz-week-2", "2026-09-07", "America/Chicago");
  await applyCommand(db, ownerId, envelope("week.commit", { weekId: "zz-week-2", itemId: "zz-item-1" }));

  const withdrawResult = await applyCommand(db, ownerId, envelope("week.withdraw", { weekId: "zz-week-2", itemId: "zz-item-1", reason: "no longer relevant" }));
  assert.equal(withdrawResult.ok, true);

  const closeResult = await applyCommand(db, ownerId, envelope("week.close", { weekId: "zz-week-2" }));
  assert.equal(closeResult.result.totalCommitments, 1, "withdrawn commitment still counts toward the denominator");
  assert.equal(closeResult.result.withdrawn, 1);
});
