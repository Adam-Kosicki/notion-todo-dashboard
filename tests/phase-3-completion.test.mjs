// Phase 3 completion batch (docs/plans/phase-3-completion-batch.md): the two committed
// completion gaps - a persisted owner planning-timezone preference (settings.setPlanningTimezone)
// and the bounded prior-weeks history read path (listRecentPlanningWeeks/
// getPlanningWeekProgressById, surfaced at GET /api/board/weeks). Exercised the same way
// tests/focus-week-commands.test.mjs and tests/period-commands.test.mjs exercise the real
// applyCommand dispatcher and repository functions - no mocks, a real (synthetic) SQLite-backed
// D1 harness.
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { createMigratedD1 } from "./helpers/d1.mjs";

register("./helpers/ts-loader.mjs", import.meta.url);
const { applyCommand } = await import("@/lib/server/commands");
const { createPlanningWeek, findPlanningWeek, listPlanningWeeks } = await import("@/lib/server/repository");
const { getOwnerTimezone, getOrCreateCurrentPlanningWeek, getPlanningWeekProgressById, listRecentPlanningWeeks, DEFAULT_PLANNING_TIMEZONE } = await import("@/lib/server/queries");

function envelope(action, payload, requestId = `req_${Math.random().toString(36).slice(2)}`) {
  return { apiVersion: 1, requestId, action, payload };
}

function freshOwner() {
  return `zz-completion-owner-${Math.random().toString(36).slice(2)}`;
}

// --- settings.setPlanningTimezone ---------------------------------------------------------

test("settings.setPlanningTimezone works for a legacy_notion owner (no Notion equivalent, same exemption as focus./week./period.)", async () => {
  const db = createMigratedD1();
  const ownerId = freshOwner();
  const result = await applyCommand(db, ownerId, envelope("settings.setPlanningTimezone", { timezone: "America/New_York" }));
  assert.equal(result.ok, true);
  assert.equal(await getOwnerTimezone(db, ownerId), "America/New_York");
});

test("getOwnerTimezone falls back to DEFAULT_PLANNING_TIMEZONE until the owner ever sets a preference", async () => {
  const db = createMigratedD1();
  const ownerId = freshOwner();
  assert.equal(await getOwnerTimezone(db, ownerId), DEFAULT_PLANNING_TIMEZONE);
});

test("settings.setPlanningTimezone rejects a string that isn't a real IANA zone name", async () => {
  const db = createMigratedD1();
  const ownerId = freshOwner();
  const result = await applyCommand(db, ownerId, envelope("settings.setPlanningTimezone", { timezone: "Not/AZone" }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "VALIDATION_FAILED");
  assert.equal(await getOwnerTimezone(db, ownerId), DEFAULT_PLANNING_TIMEZONE, "a rejected change must not partially apply");
});

test("changing the timezone preference affects only NEW weeks - an already-created week keeps the timezone it was created with", async () => {
  const db = createMigratedD1();
  const ownerId = freshOwner();

  // A week already exists, created under the default timezone.
  const originalWeek = await getOrCreateCurrentPlanningWeek(db, ownerId, DEFAULT_PLANNING_TIMEZONE);
  assert.equal(originalWeek.timezone, DEFAULT_PLANNING_TIMEZONE);

  const changed = await applyCommand(db, ownerId, envelope("settings.setPlanningTimezone", { timezone: "Asia/Tokyo" }));
  assert.equal(changed.ok, true);

  // Re-reading the SAME week (by id, not by re-deriving "today" in the new zone) must not have
  // rewritten its stored timezone.
  const reread = await findPlanningWeek(db, ownerId, originalWeek.id);
  assert.equal(reread.timezone, DEFAULT_PLANNING_TIMEZONE, "an existing week's recorded timezone must never be reinterpreted after a preference change");
});

test("settings.setPlanningTimezone records a before/after activity event, so a timezone change has an audit trail", async () => {
  const db = createMigratedD1();
  const ownerId = freshOwner();
  await applyCommand(db, ownerId, envelope("settings.setPlanningTimezone", { timezone: "Europe/Berlin" }));
  const events = await db.prepare("SELECT event_type, before_json, after_json FROM activity_events WHERE owner_id = ?").bind(ownerId).all();
  const event = events.results.find((row) => row.event_type === "settings.timezone_changed");
  assert.ok(event, "expected a settings.timezone_changed activity event");
  assert.deepEqual(JSON.parse(event.after_json), { timezone: "Europe/Berlin" });
});

// --- Prior-weeks history read path (app/api/board/weeks) ---------------------------------

test("listRecentPlanningWeeks returns every owner-scoped week, most recent first, bounded by the given limit", async () => {
  const db = createMigratedD1();
  const ownerId = freshOwner();
  await createPlanningWeek(db, ownerId, "week_2026-08-24", "2026-08-24", "America/Chicago");
  await createPlanningWeek(db, ownerId, "week_2026-08-31", "2026-08-31", "America/Chicago");
  await createPlanningWeek(db, ownerId, "week_2026-09-07", "2026-09-07", "America/Chicago");

  const weeks = await listRecentPlanningWeeks(db, ownerId, 50);
  assert.deepEqual(weeks.map((week) => week.id), ["week_2026-09-07", "week_2026-08-31", "week_2026-08-24"]);

  const bounded = await listRecentPlanningWeeks(db, ownerId, 2);
  assert.equal(bounded.length, 2, "the limit must actually bound the result, not just default it");
  assert.deepEqual(bounded.map((week) => week.id), ["week_2026-09-07", "week_2026-08-31"]);
});

test("listRecentPlanningWeeks never returns another owner's weeks", async () => {
  const db = createMigratedD1();
  const ownerId = freshOwner();
  const otherOwnerId = freshOwner();
  await createPlanningWeek(db, ownerId, "week_2026-09-07", "2026-09-07", "America/Chicago");
  await createPlanningWeek(db, otherOwnerId, "week_2026-09-07", "2026-09-07", "America/Chicago");

  const weeks = await listPlanningWeeks(db, ownerId, 50);
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].id, "week_2026-09-07");
});

test("getPlanningWeekProgressById reaches a PRIOR (non-current) week's frozen report - the completion gap this fixes", async () => {
  const db = createMigratedD1();
  const ownerId = freshOwner();
  await db
    .prepare(
      `INSERT INTO items (owner_id, id, title, status, item_type, version, review_state, recorded_at, updated_at, raw_json)
       VALUES (?, 'zz-item-1', 'Zz Test rollover item', 'Not started', 'Task', 1, 'needs_review', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '{}')`,
    )
    .bind(ownerId)
    .run();

  // A week from a prior rollover, committed to and then closed - simulating a week that "rolled
  // over" before the owner got to close it via the (previously current-only) UI.
  await createPlanningWeek(db, ownerId, "week_2026-08-24", "2026-08-24", "America/Chicago");
  await applyCommand(db, ownerId, envelope("week.commit", { weekId: "week_2026-08-24", itemId: "zz-item-1" }));
  const closed = await applyCommand(db, ownerId, envelope("week.close", { weekId: "week_2026-08-24" }));
  assert.equal(closed.ok, true);

  // A separate, unrelated CURRENT week exists too - the read path must fetch the PRIOR one by id,
  // not silently substitute the current one.
  await createPlanningWeek(db, ownerId, "week_2026-09-07", "2026-09-07", "America/Chicago");

  const priorWeek = await getPlanningWeekProgressById(db, ownerId, "week_2026-08-24");
  assert.ok(priorWeek, "a prior week must remain reachable by id after rollover");
  assert.equal(priorWeek.status, "closed");
  assert.equal(priorWeek.stats.status, "computed");
  assert.equal(priorWeek.stats.completionRatioLabel, "0/1");
});

test("getPlanningWeekProgressById returns null (not another owner's data) for an unknown or not-owned weekId", async () => {
  const db = createMigratedD1();
  const ownerId = freshOwner();
  const otherOwnerId = freshOwner();
  await createPlanningWeek(db, otherOwnerId, "week_2026-09-07", "2026-09-07", "America/Chicago");

  assert.equal(await getPlanningWeekProgressById(db, ownerId, "week_does_not_exist"), null);
  assert.equal(await getPlanningWeekProgressById(db, ownerId, "week_2026-09-07"), null, "must not leak another owner's week by id");
});

test("a still-open prior week found via the history read path can still be committed to, withdrawn from, and closed - not just viewed", async () => {
  const db = createMigratedD1();
  const ownerId = freshOwner();
  await db
    .prepare(
      `INSERT INTO items (owner_id, id, title, status, item_type, version, review_state, recorded_at, updated_at, raw_json)
       VALUES (?, 'zz-item-1', 'Zz Test stale week item', 'Not started', 'Task', 1, 'needs_review', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '{}')`,
    )
    .bind(ownerId)
    .run();

  // A stale week from before this feature existed: never closed, and no longer "current" once a
  // newer week exists.
  await createPlanningWeek(db, ownerId, "week_2026-08-24", "2026-08-24", "America/Chicago");
  await createPlanningWeek(db, ownerId, "week_2026-09-07", "2026-09-07", "America/Chicago");

  const commit = await applyCommand(db, ownerId, envelope("week.commit", { weekId: "week_2026-08-24", itemId: "zz-item-1" }));
  assert.equal(commit.ok, true);

  const found = await getPlanningWeekProgressById(db, ownerId, "week_2026-08-24");
  assert.equal(found.status, "open");
  assert.equal(found.commitments.length, 1);

  const closed = await applyCommand(db, ownerId, envelope("week.close", { weekId: "week_2026-08-24" }));
  assert.equal(closed.ok, true);
  const reread = await findPlanningWeek(db, ownerId, "week_2026-08-24");
  assert.equal(reread.status, "closed");
});
