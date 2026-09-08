// Phase 3 extension (docs/adr/local/time-horizon-quick-actions.md): period.commit/period.withdraw
// through the real applyCommand dispatcher, for the generic Today/Month/Year planning_periods
// system. Mirrors tests/focus-week-commands.test.mjs's week.commit/week.withdraw coverage - same
// legacy_notion-owner exemption, same idempotency/re-add/scoping shape - but without a close
// step, since v1 periods never close (see lib/server/commands.ts's periodCommitPlan comment).
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { createMigratedD1 } from "./helpers/d1.mjs";

register("./helpers/ts-loader.mjs", import.meta.url);
const { applyCommand } = await import("@/lib/server/commands");
const { createPlanningPeriod, findPeriodCommitment, findPlanningPeriod, listPeriodCommitments } = await import("@/lib/server/repository");
const { computeCurrentPeriodStats } = await import("@/lib/server/queries");

function envelope(action, payload, requestId = `req_${Math.random().toString(36).slice(2)}`) {
  return { apiVersion: 1, requestId, action, payload };
}

async function legacyOwnerWithItem(ownerId = `zz-period-owner-${Math.random().toString(36).slice(2)}`) {
  const db = createMigratedD1();
  await db
    .prepare(
      `INSERT INTO items (owner_id, id, title, status, item_type, version, review_state, recorded_at, updated_at, raw_json)
       VALUES (?, 'zz-item-1', 'Zz Test period item', 'Not started', 'Task', 1, 'needs_review', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '{}')`,
    )
    .bind(ownerId)
    .run();
  return { db, ownerId };
}

test("period.commit works for a legacy_notion owner (Today/Month/Year has no Notion equivalent, so it's exempt)", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  await createPlanningPeriod(db, ownerId, "day_2026-09-07", "day", "2026-09-07", "2026-09-08", "America/Chicago");

  const result = await applyCommand(db, ownerId, envelope("period.commit", { periodType: "day", periodId: "day_2026-09-07", itemId: "zz-item-1" }));
  assert.equal(result.ok, true);
  const rows = await listPeriodCommitments(db, ownerId, "day_2026-09-07");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].item_id, "zz-item-1");
});

test("period.commit is idempotent for an already-active commitment (no duplicate row, no error)", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  await createPlanningPeriod(db, ownerId, "month_2026-09-01", "month", "2026-09-01", "2026-10-01", "America/Chicago");

  await applyCommand(db, ownerId, envelope("period.commit", { periodType: "month", periodId: "month_2026-09-01", itemId: "zz-item-1" }));
  const recommit = await applyCommand(db, ownerId, envelope("period.commit", { periodType: "month", periodId: "month_2026-09-01", itemId: "zz-item-1" }));
  assert.equal(recommit.ok, true);
  assert.equal((await listPeriodCommitments(db, ownerId, "month_2026-09-01")).length, 1);
});

test("period.commit rejects an itemId that does not exist", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  await createPlanningPeriod(db, ownerId, "year_2026-01-01", "year", "2026-01-01", "2027-01-01", "America/Chicago");
  const result = await applyCommand(db, ownerId, envelope("period.commit", { periodType: "year", periodId: "year_2026-01-01", itemId: "zz-nonexistent" }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "VALIDATION_FAILED");
});

test("period.commit rejects a periodType that doesn't match the periodId's actual period_type", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  await createPlanningPeriod(db, ownerId, "day_2026-09-07", "day", "2026-09-07", "2026-09-08", "America/Chicago");
  const result = await applyCommand(db, ownerId, envelope("period.commit", { periodType: "month", periodId: "day_2026-09-07", itemId: "zz-item-1" }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "VALIDATION_FAILED");
});

test("period.commit supports add -> withdraw -> re-add, clearing the prior withdrawal", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  await createPlanningPeriod(db, ownerId, "day_2026-09-07", "day", "2026-09-07", "2026-09-08", "America/Chicago");

  await applyCommand(db, ownerId, envelope("period.commit", { periodType: "day", periodId: "day_2026-09-07", itemId: "zz-item-1" }));
  const withdrawn = await applyCommand(db, ownerId, envelope("period.withdraw", { periodType: "day", periodId: "day_2026-09-07", itemId: "zz-item-1" }));
  assert.equal(withdrawn.ok, true);

  const readded = await applyCommand(db, ownerId, envelope("period.commit", { periodType: "day", periodId: "day_2026-09-07", itemId: "zz-item-1" }));
  assert.equal(readded.ok, true, "re-adding a withdrawn commitment must succeed, not CONFLICT");

  const row = await findPeriodCommitment(db, ownerId, "day_2026-09-07", "zz-item-1");
  assert.equal(row.withdrawn_at, null, "re-adding clears the prior withdrawal");
});

test("period.withdraw rejects a commitment that doesn't exist", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  await createPlanningPeriod(db, ownerId, "day_2026-09-07", "day", "2026-09-07", "2026-09-08", "America/Chicago");
  const result = await applyCommand(db, ownerId, envelope("period.withdraw", { periodType: "day", periodId: "day_2026-09-07", itemId: "zz-item-1" }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NOT_FOUND");
});

test("period.withdraw keeps the commitment row (for the denominator) and marks it withdrawn", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  await createPlanningPeriod(db, ownerId, "day_2026-09-07", "day", "2026-09-07", "2026-09-08", "America/Chicago");
  await applyCommand(db, ownerId, envelope("period.commit", { periodType: "day", periodId: "day_2026-09-07", itemId: "zz-item-1" }));

  const withdrawResult = await applyCommand(db, ownerId, envelope("period.withdraw", { periodType: "day", periodId: "day_2026-09-07", itemId: "zz-item-1", reason: "no longer relevant" }));
  assert.equal(withdrawResult.ok, true);

  const period = await findPlanningPeriod(db, ownerId, "day_2026-09-07");
  const stats = await computeCurrentPeriodStats(db, ownerId, period);
  assert.equal(stats.totalCommitments, 1, "withdrawn commitment still counts toward the denominator");
  assert.equal(stats.withdrawn, 1);
});

test("commit/withdraw history is scoped per period - withdrawing an item from a DIFFERENT period must not affect this period's stats (same shape as the week scoping fix)", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  await createPlanningPeriod(db, ownerId, "month_2026-09-01", "month", "2026-09-01", "2026-10-01", "America/Chicago");
  await createPlanningPeriod(db, ownerId, "month_2026-10-01", "month", "2026-10-01", "2026-11-01", "America/Chicago");

  // Commit the same item to both September and October.
  await applyCommand(db, ownerId, envelope("period.commit", { periodType: "month", periodId: "month_2026-09-01", itemId: "zz-item-1" }));
  await applyCommand(db, ownerId, envelope("period.commit", { periodType: "month", periodId: "month_2026-10-01", itemId: "zz-item-1" }));

  // Withdraw it from October only - September's commitment stays active.
  const withdrawn = await applyCommand(db, ownerId, envelope("period.withdraw", { periodType: "month", periodId: "month_2026-10-01", itemId: "zz-item-1" }));
  assert.equal(withdrawn.ok, true);

  // Complete it (within September's window).
  await db.prepare("UPDATE items SET status = 'Done', completed_at = CURRENT_TIMESTAMP WHERE owner_id = ? AND id = ?").bind(ownerId, "zz-item-1").run();
  await db
    .prepare(
      "INSERT INTO activity_events (id, owner_id, entity_id, actor_kind, event_type, request_id, before_json, after_json, timestamp) VALUES ('zz-evt-period-scope', ?, 'zz-item-1', 'owner', 'items.complete', 'zz-req', NULL, NULL, ?)",
    )
    .bind(ownerId, new Date().toISOString())
    .run();

  const september = await findPlanningPeriod(db, ownerId, "month_2026-09-01");
  const stats = await computeCurrentPeriodStats(db, ownerId, september);
  assert.equal(stats.completed, 1, "withdrawing from a different period must not flip this period's commitment to inactive");
  assert.equal(stats.completionRatioLabel, "1/1");
});

test("period.commit is rejected for a period that doesn't exist", async () => {
  const { db, ownerId } = await legacyOwnerWithItem();
  const result = await applyCommand(db, ownerId, envelope("period.commit", { periodType: "day", periodId: "day_nonexistent", itemId: "zz-item-1" }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NOT_FOUND");
});
