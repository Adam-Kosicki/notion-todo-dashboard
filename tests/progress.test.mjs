// Phase 3 (docs/plans/burner-board-roadmap.md, section 6 "Weekly statistics contract"): unit
// tests for the pure computation in lib/domain/progress.ts. No DB, no register() needed - the
// module has zero cross-file imports of its own, so a plain dynamic import over Vite's
// ssrLoadModule (same pipeline as tests/ui-components.test.mjs) handles the TS-stripping.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const { computeWeekStats, weekEndDate, mondayStartOf, zonedMidnightUtc } = await vite.ssrLoadModule("/lib/domain/progress.ts");

test.after(async () => {
  await vite.close();
});

// Tests that don't care about timezone behavior use "UTC", where zonedMidnightUtc(date, "UTC")
// is exactly `${date}T00:00:00.000Z` - i.e. identical to the old (pre-Astra-review) plain-string
// comparison, so these keep testing the same rules as before the timezone fix.
const UTC_WEEK = { startDate: "2026-09-07", endDate: "2026-09-14", timezone: "UTC" };

test("zero commitments produces the 'No tasks planned' label, not a percentage", () => {
  const stats = computeWeekStats({ week: UTC_WEEK, commitments: [], itemsById: {}, events: [] });
  assert.deepEqual(stats, { status: "no_commitments", label: "No tasks planned" });
});

test("denominator counts every commitment added, including a withdrawn one", () => {
  const stats = computeWeekStats({
    week: UTC_WEEK,
    commitments: [
      { itemId: "a", addedAt: "2026-09-07T10:00:00.000Z", withdrawnAt: null },
      { itemId: "b", addedAt: "2026-09-07T10:00:00.000Z", withdrawnAt: "2026-09-09T10:00:00.000Z" },
    ],
    itemsById: { a: { itemType: "Task" }, b: { itemType: "Task" } },
    events: [{ itemId: "a", eventType: "items.complete", timestamp: "2026-09-08T10:00:00.000Z" }],
  });
  assert.equal(stats.status, "computed");
  assert.equal(stats.totalCommitments, 2, "withdrawn commitment still counts toward the denominator");
  assert.equal(stats.added, 2);
  assert.equal(stats.withdrawn, 1);
  assert.equal(stats.completed, 1);
  assert.equal(stats.completionRatioLabel, "1/2");
});

test("goals and reference items are excluded from the task ratio but tracked as milestones", () => {
  const stats = computeWeekStats({
    week: UTC_WEEK,
    commitments: [
      { itemId: "task1", addedAt: "2026-09-07T10:00:00.000Z", withdrawnAt: null },
      { itemId: "goal1", addedAt: "2026-09-07T10:00:00.000Z", withdrawnAt: null },
    ],
    itemsById: { task1: { itemType: "Task" }, goal1: { itemType: "Goal" } },
    events: [
      { itemId: "task1", eventType: "items.complete", timestamp: "2026-09-08T10:00:00.000Z" },
      { itemId: "goal1", eventType: "items.complete", timestamp: "2026-09-09T10:00:00.000Z" },
    ],
  });
  assert.equal(stats.taskCommitments, 1);
  assert.equal(stats.completed, 1, "the goal's completion must not inflate the task ratio");
  assert.equal(stats.goalMilestonesCompleted, 1);
  assert.equal(stats.completionRatioLabel, "1/1");
});

test("a completion after the week ends is a late completion, not on-time success", () => {
  const stats = computeWeekStats({
    week: UTC_WEEK,
    commitments: [{ itemId: "a", addedAt: "2026-09-07T10:00:00.000Z", withdrawnAt: null }],
    itemsById: { a: { itemType: "Task" } },
    events: [{ itemId: "a", eventType: "items.complete", timestamp: "2026-09-15T10:00:00.000Z" }],
  });
  assert.equal(stats.completed, 0);
  assert.equal(stats.lateCompletions, 1);
});

test("a reopen after a complete, both inside the week, reverses the completion contribution", () => {
  const stats = computeWeekStats({
    week: UTC_WEEK,
    commitments: [{ itemId: "a", addedAt: "2026-09-07T10:00:00.000Z", withdrawnAt: null }],
    itemsById: { a: { itemType: "Task" } },
    events: [
      { itemId: "a", eventType: "items.complete", timestamp: "2026-09-08T10:00:00.000Z" },
      { itemId: "a", eventType: "items.reopen", timestamp: "2026-09-09T10:00:00.000Z" },
    ],
  });
  assert.equal(stats.completed, 0, "reopening within the week must reverse the earlier completion, regardless of event insertion order");
  assert.equal(stats.lateCompletions, 0, "a reversed completion is not also counted as late");
});

// --- Astra review (Phase 3 Slice 1, c02e352) regression cases ---

test("Astra counterexample: completing before the commitment was even added does not count as this week's win", () => {
  const stats = computeWeekStats({
    week: UTC_WEEK,
    commitments: [{ itemId: "a", addedAt: "2026-09-10T00:00:00.000Z", withdrawnAt: null }],
    itemsById: { a: { itemType: "Task" } },
    events: [{ itemId: "a", eventType: "items.complete", timestamp: "2026-09-08T00:00:00.000Z" }],
  });
  assert.equal(stats.completed, 0, "completed before selection isn't this week's completion");
  assert.equal(stats.lateCompletions, 0, "it's also not a late completion - it just predates being selected");
});

test("Astra counterexample: a completion just before local midnight Monday in the planning timezone belongs to the prior week, not this one", () => {
  // 2026-09-07T04:30:00Z is 2026-09-06T23:30 in America/Chicago (CDT, UTC-5 in September) -
  // Sunday night, not yet the Monday-starting week.
  const chicagoWeek = { startDate: "2026-09-07", endDate: "2026-09-14", timezone: "America/Chicago" };
  const stats = computeWeekStats({
    week: chicagoWeek,
    commitments: [{ itemId: "a", addedAt: "2026-09-01T00:00:00.000Z", withdrawnAt: null }],
    itemsById: { a: { itemType: "Task" } },
    events: [{ itemId: "a", eventType: "items.complete", timestamp: "2026-09-07T04:30:00.000Z" }],
  });
  assert.equal(stats.completed, 0, "04:30 UTC is still Sunday night in Chicago - not inside the Monday-starting week");
});

test("Astra counterexample: completing inside the week then reopening the following week does not erase this week's completion", () => {
  const stats = computeWeekStats({
    week: UTC_WEEK,
    commitments: [{ itemId: "a", addedAt: "2026-09-07T00:00:00.000Z", withdrawnAt: null }],
    itemsById: { a: { itemType: "Task" } },
    events: [
      { itemId: "a", eventType: "items.complete", timestamp: "2026-09-08T00:00:00.000Z" },
      { itemId: "a", eventType: "items.reopen", timestamp: "2026-09-15T00:00:00.000Z" }, // the following week
    ],
  });
  assert.equal(stats.completed, 1, "a reopen in a LATER week must not retroactively erase an earlier, already-elapsed week's completion");
});

test("zonedMidnightUtc resolves correctly across a US DST transition (America/Chicago, 2026-11-01 -> CST)", () => {
  // 2026-11-01 is the day US clocks fall back; Chicago is UTC-5 (CDT) before 2am local and
  // UTC-6 (CST) after. Midnight local on 2026-11-01 is still CDT (UTC-5).
  assert.equal(zonedMidnightUtc("2026-11-01", "America/Chicago"), "2026-11-01T05:00:00.000Z");
  // A week later, fully into standard time, midnight local is UTC-6.
  assert.equal(zonedMidnightUtc("2026-11-09", "America/Chicago"), "2026-11-09T06:00:00.000Z");
});

test("weekEndDate is exclusive and exactly 7 days after startDate", () => {
  assert.equal(weekEndDate("2026-09-07"), "2026-09-14");
});

test("mondayStartOf finds the correct Monday for a mid-week date in a named timezone", () => {
  // 2026-09-10 is a Thursday; the Monday of that week is 2026-09-07.
  const thursdayNoonUtc = new Date("2026-09-10T12:00:00Z");
  assert.equal(mondayStartOf(thursdayNoonUtc, "America/Chicago"), "2026-09-07");
});

test("mondayStartOf returns the same date when now is already a Monday", () => {
  const mondayNoonUtc = new Date("2026-09-07T12:00:00Z");
  assert.equal(mondayStartOf(mondayNoonUtc, "America/Chicago"), "2026-09-07");
});
