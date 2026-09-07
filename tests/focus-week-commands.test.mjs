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
  // Bound explicitly, in real ISO-8601 - SQLite's own CURRENT_TIMESTAMP default produces
  // "YYYY-MM-DD HH:MM:SS" (a space, not "T"), which sorts as LESS than any same-day ISO instant
  // and would make progress.ts's instant comparisons silently misclassify this completion.
  await db
    .prepare(
      "INSERT INTO activity_events (id, owner_id, entity_id, actor_kind, event_type, request_id, before_json, after_json, timestamp) VALUES ('zz-evt-1', ?, 'zz-item-1', 'owner', 'items.complete', 'zz-req', NULL, NULL, ?)",
    )
    .bind(ownerId, new Date().toISOString())
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

// --- Astra review (Phase 3 Slice 1, first round, c02e352) regression cases ---

test("week.commit supports add -> withdraw -> re-add (roadmap Phase 3 acceptance criteria); added_at refreshes for display, but on-time credit no longer depends on it (see progress.test.mjs)", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  await createPlanningWeek(db, ownerId, "zz-week-readd", "2026-09-07", "America/Chicago");

  await applyCommand(db, ownerId, envelope("week.commit", { weekId: "zz-week-readd", itemId: "zz-item-1" }));
  const withdrawn = await applyCommand(db, ownerId, envelope("week.withdraw", { weekId: "zz-week-readd", itemId: "zz-item-1" }));
  assert.equal(withdrawn.ok, true);

  const readded = await applyCommand(db, ownerId, envelope("week.commit", { weekId: "zz-week-readd", itemId: "zz-item-1" }));
  assert.equal(readded.ok, true, "re-adding a withdrawn commitment must succeed, not CONFLICT");

  const { findWeekCommitment } = await import("@/lib/server/repository");
  const row = await findWeekCommitment(db, ownerId, "zz-week-readd", "zz-item-1");
  assert.equal(row.withdrawn_at, null, "re-adding clears the prior withdrawal");

  const closeResult = await applyCommand(db, ownerId, envelope("week.close", { weekId: "zz-week-readd" }));
  assert.equal(closeResult.result.totalCommitments, 1, "still exactly one commitment row - re-add is an upsert, not a second row");
});

test("Blocker B: week.commit is rejected (not silently accepted) while a week is mid-close", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  await createPlanningWeek(db, ownerId, "zz-week-race", "2026-09-07", "America/Chicago");
  // Simulate weekClose having entered its exclusive 'closing' phase (beginClosingPlanningWeek)
  // but not yet finalized - the exact window Astra's review flagged as racy.
  await db.prepare("UPDATE planning_weeks SET status = 'closing' WHERE owner_id = ? AND id = ?").bind(ownerId, "zz-week-race").run();

  const commitDuringClose = await applyCommand(db, ownerId, envelope("week.commit", { weekId: "zz-week-race", itemId: "zz-item-1" }));
  assert.equal(commitDuringClose.ok, false);
  assert.equal(commitDuringClose.error.code, "CONFLICT", "commit must not land while the week is being closed");

  const { listWeekCommitments } = await import("@/lib/server/repository");
  assert.deepEqual(await listWeekCommitments(db, ownerId, "zz-week-race"), [], "no commitment row was written despite the rejected command");
});

test("Blocker B: week.withdraw is rejected while a week is mid-close", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  await createPlanningWeek(db, ownerId, "zz-week-race-2", "2026-09-07", "America/Chicago");
  await applyCommand(db, ownerId, envelope("week.commit", { weekId: "zz-week-race-2", itemId: "zz-item-1" }));
  await db.prepare("UPDATE planning_weeks SET status = 'closing' WHERE owner_id = ? AND id = ?").bind(ownerId, "zz-week-race-2").run();

  const withdrawDuringClose = await applyCommand(db, ownerId, envelope("week.withdraw", { weekId: "zz-week-race-2", itemId: "zz-item-1" }));
  assert.equal(withdrawDuringClose.ok, false);
  assert.equal(withdrawDuringClose.error.code, "CONFLICT");

  const { findWeekCommitment } = await import("@/lib/server/repository");
  const row = await findWeekCommitment(db, ownerId, "zz-week-race-2", "zz-item-1");
  assert.equal(row.withdrawn_at, null, "the commitment must still be active - the withdraw never landed");
});

// --- Astra review (remediation round, 7060176^..1698bc8) regression cases ---

test("Astra P1#2: a withdrawal racing a concurrent withdrawal of the same item is a CONFLICT, with no stray success receipt or revision bump", async () => {
  const { db: realDb, ownerId } = await legacyOwnerWithItem();
  await createPlanningWeek(realDb, ownerId, "zz-week-p1-2", "2026-09-07", "America/Chicago");
  await applyCommand(realDb, ownerId, envelope("week.commit", { weekId: "zz-week-p1-2", itemId: "zz-item-1" }));

  // Simulate a second, concurrent week.withdraw request committing its own transaction in the
  // exact gap between THIS request's own pre-read (which still sees the commitment as active)
  // and its atomic batch actually executing - the race Astra's review found, where the
  // bookkeeping guard previously checked only "week open" while the primary UPDATE also required
  // "withdrawn_at IS NULL", so this exact scenario used to store a success receipt for a command
  // that returned CONFLICT.
  let racedOnce = false;
  const racyDb = {
    prepare: (sql) => realDb.prepare(sql),
    async batch(statements) {
      if (!racedOnce) {
        racedOnce = true;
        await realDb
          .prepare("UPDATE week_commitments SET withdrawn_at = CURRENT_TIMESTAMP WHERE owner_id = ? AND week_id = ? AND item_id = ?")
          .bind(ownerId, "zz-week-p1-2", "zz-item-1")
          .run();
      }
      return realDb.batch(statements);
    },
  };

  const { getBoardState, getReceipt } = await import("@/lib/server/repository");
  const stateBefore = await getBoardState(realDb, ownerId);
  const requestId = "req_p1_2_race";
  const result = await applyCommand(racyDb, ownerId, envelope("week.withdraw", { weekId: "zz-week-p1-2", itemId: "zz-item-1" }, requestId));
  assert.equal(result.ok, false, "the primary UPDATE affects zero rows once the concurrent withdrawal has already landed");
  assert.equal(result.error.code, "CONFLICT");

  assert.equal(await getReceipt(realDb, ownerId, requestId), null, "no receipt may be stored for a request whose domain mutation never actually applied - a retry with this exact requestId must not replay a false success");
  const stateAfter = await getBoardState(realDb, ownerId);
  assert.equal(stateAfter.revision, stateBefore.revision, "no revision bump for a command that didn't actually mutate anything");
});

test("Astra P1#3: a command whose board revision moved between its own read and its batch reports CONFLICT, never a guessed/incorrect revision", async () => {
  const { db: realDb, ownerId } = await legacyOwnerWithItem();

  // Simulate a fully independent concurrent command (any action, for any item) committing its
  // own revision bump in the gap between THIS request's own read and its batch actually
  // executing. The original design computed `boardRevisionBefore + 1` from that earlier read with
  // no guard tying the relative `revision = revision + 1` SQL to it - two such commands could both
  // report/receipt "1" while the database reached 2.
  let racedOnce = false;
  const racyDb = {
    prepare: (sql) => realDb.prepare(sql),
    async batch(statements) {
      if (!racedOnce) {
        racedOnce = true;
        await realDb.prepare("UPDATE board_state SET revision = revision + 1 WHERE owner_id = ?").bind(ownerId).run();
      }
      return realDb.batch(statements);
    },
  };

  const requestId = "req_p1_3_race";
  const result = await applyCommand(racyDb, ownerId, envelope("focus.set", { itemId: "zz-item-1", focused: true }, requestId));
  assert.equal(result.ok, false, "the board-revision CAS must fail once a concurrent command has already bumped it");
  assert.equal(result.error.code, "CONFLICT");

  const { getReceipt } = await import("@/lib/server/repository");
  assert.equal(await getReceipt(realDb, ownerId, requestId), null, "no receipt - and certainly none claiming an incorrect revision - may be stored for a command whose CAS failed");
  assert.deepEqual(await listFocusItems(realDb, ownerId), [], "the focus mutation itself must not have applied either - it's gated by the same CAS as the bookkeeping");
});

test("a normal successful sequence of commands still bumps the board revision each time, matching the returned boardRevision", async () => {
  // Guards against a regression the P1#2 fix's first (buggy) attempt actually introduced: gating
  // the revision-bump statement on a re-check of the domain guard self-invalidated on SUCCESS
  // (the primary statement, running just before it, had already mutated the very row that guard
  // reads), silently skipping the bump while still reporting success.
  const { db, ownerId } = await legacyOwnerWithItem();
  const { getBoardState } = await import("@/lib/server/repository");
  await createPlanningWeek(db, ownerId, "zz-week-revcheck", "2026-09-07", "America/Chicago");

  const committed = await applyCommand(db, ownerId, envelope("week.commit", { weekId: "zz-week-revcheck", itemId: "zz-item-1" }));
  assert.equal(committed.ok, true);
  assert.equal(committed.boardRevision, 1);
  assert.equal((await getBoardState(db, ownerId)).revision, 1, "the revision bump must actually land, not just be reported");

  const withdrawn = await applyCommand(db, ownerId, envelope("week.withdraw", { weekId: "zz-week-revcheck", itemId: "zz-item-1" }));
  assert.equal(withdrawn.ok, true);
  assert.equal(withdrawn.boardRevision, 2);
  assert.equal((await getBoardState(db, ownerId)).revision, 2);
});

test("Blocker B: a week stuck in 'closing' (crash between beginClosingPlanningWeek and finalize) is resumed and finalized by the next week.close call, not stuck forever", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  await createPlanningWeek(db, ownerId, "zz-week-stuck", "2026-09-07", "America/Chicago");
  await applyCommand(db, ownerId, envelope("week.commit", { weekId: "zz-week-stuck", itemId: "zz-item-1" }));
  // Simulate a crash exactly after the CAS to 'closing' but before the finalize batch ran.
  await db.prepare("UPDATE planning_weeks SET status = 'closing' WHERE owner_id = ? AND id = ?").bind(ownerId, "zz-week-stuck").run();

  const resumed = await applyCommand(db, ownerId, envelope("week.close", { weekId: "zz-week-stuck" }));
  assert.equal(resumed.ok, true, "week.close must resume and finalize a 'closing' week rather than erroring or leaving it stuck");
  assert.equal(resumed.result.status, "computed");

  const { findPlanningWeek } = await import("@/lib/server/repository");
  const week = await findPlanningWeek(db, ownerId, "zz-week-stuck");
  assert.equal(week.status, "closed");
});

test("Blocker B: week.commit's mutation, revision bump, activity event, and receipt are ONE atomic batch() call, not separate round trips that can partially fail", async () => {
  const { db: realDb, ownerId } = await legacyOwnerWithItem();
  await createPlanningWeek(realDb, ownerId, "zz-week-fault", "2026-09-07", "America/Chicago");

  let batchCallCount = 0;
  let lastBatchSize = 0;
  const spyDb = {
    prepare: (sql) => realDb.prepare(sql),
    async batch(statements) {
      batchCallCount++;
      lastBatchSize = statements.length;
      return realDb.batch(statements);
    },
  };
  const result = await applyCommand(spyDb, ownerId, envelope("week.commit", { weekId: "zz-week-fault", itemId: "zz-item-1" }));
  assert.equal(result.ok, true);
  assert.equal(batchCallCount, 1, "the old design ran the mutation, revision bump, event append, and receipt save as 4 separate awaited D1 round trips - Terra's fault injection proved a crash between any two of them leaves a permanently inconsistent state");
  assert.ok(lastBatchSize >= 3, "the single batch must actually bundle the revision bump, activity event, and receipt together with the mutation, not just the mutation alone");
});

test("Blocker B: if that single batch() call fails outright (e.g. the request never reaches D1), nothing partial lands - no commitment row, no event, no receipt, no revision bump", async () => {
  const { db: realDb, ownerId } = await legacyOwnerWithItem();
  await createPlanningWeek(realDb, ownerId, "zz-week-fault-2", "2026-09-07", "America/Chicago");

  const failingDb = {
    prepare: (sql) => realDb.prepare(sql),
    async batch() {
      throw new Error("simulated network failure - the request never reached D1");
    },
  };
  const requestId = "req_fault_injection_2";
  const result = await applyCommand(failingDb, ownerId, envelope("week.commit", { weekId: "zz-week-fault-2", itemId: "zz-item-1" }, requestId));
  assert.equal(result.ok, false, "the command must report failure, not a false success");

  const { listWeekCommitments, getBoardState, getReceipt } = await import("@/lib/server/repository");
  assert.deepEqual(await listWeekCommitments(realDb, ownerId, "zz-week-fault-2"), [], "no commitment row despite the attempted (and failed) command");
  assert.equal(await getReceipt(realDb, ownerId, requestId), null, "no receipt was saved for the failed attempt");
  assert.equal((await getBoardState(realDb, ownerId)).revision, 0, "board revision must not have advanced for a failed command");
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
