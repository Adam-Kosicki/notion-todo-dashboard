// Phase 1 (docs/plans/burner-board-roadmap.md): read paths for the new d1_primary tables.
// Deliberately minimal this phase - History, cursor pagination, and scoped-context queries
// belong to phases 2-4 as their UI/MCP consumers land. Same runtime-agnostic Database
// dependency-injection pattern as repository.ts/commands.ts - see repository.ts's file comment.
import { computePeriodStats, mondayStartOf, periodEndDate, periodStartOf, weekEndDate, type PeriodStats, type PeriodType } from "@/lib/domain/progress";
import { LIMITS } from "@/lib/domain/contracts";
import {
  createPlanningPeriod,
  createPlanningWeek,
  findItemRow,
  findPlanningPeriodByTypeAndStart,
  findPlanningWeek,
  findPlanningWeekByStartDate,
  getBoardState,
  getOwnerPlanningTimezone,
  listActivityEventsForItems,
  listFocusItems,
  listPeriodCommitments,
  listPlanningWeeks,
  listWeekCommitments,
  type Database,
  type FocusItemRow,
  type ItemRow,
  type ListRow,
  type PlanningPeriodRow,
  type PlanningWeekRow,
  type PlanningWeekSummary,
} from "@/lib/server/repository";

export type BoardSnapshot = {
  revision: number;
  storageMode: string;
  items: ItemRow[];
  lists: ListRow[];
};

/** Full current-state snapshot for a d1_primary owner. Not paginated - fine for tests and small synthetic boards; a real cursor-paginated version arrives in phase 2 alongside History. */
export async function getBoardSnapshot(db: Database, ownerId: string): Promise<BoardSnapshot> {
  const state = await getBoardState(db, ownerId);
  const items = await db
    .prepare("SELECT * FROM items WHERE owner_id = ? AND deleted_at IS NULL ORDER BY recorded_at")
    .bind(ownerId)
    .all<ItemRow>();
  const lists = await db
    .prepare("SELECT owner_id, id, name FROM lists WHERE owner_id = ? ORDER BY name COLLATE NOCASE")
    .bind(ownerId)
    .all<ListRow>();
  return { revision: state.revision, storageMode: state.storageMode, items: items.results, lists: lists.results };
}

// --- Phase 3 slice 2: Focus and weekly-progress reads --------------------------------------

/**
 * Suggested initial default per the roadmap's weekly statistics contract ("suggested initial
 * value for this owner is America/Chicago, never infer it permanently from the server
 * timezone"). No per-owner timezone preference exists yet - that's a later setup-flow decision,
 * not guessed here. Centralized so it's one place to change when that preference ships.
 */
export const DEFAULT_PLANNING_TIMEZONE = "America/Chicago";

/**
 * Phase 3 completion: the owner's persisted timezone preference (lib/server/commands.ts's
 * settings.setPlanningTimezone), falling back to DEFAULT_PLANNING_TIMEZONE until the owner ever
 * sets one - never the other way around. Callers use this ONLY to pick the timezone for a *new*
 * planning_weeks/planning_periods row (see getOrCreateCurrentPlanningWeek/Period below); an
 * existing row already recorded its own timezone at creation time and keeps it regardless of
 * later preference changes - the roadmap's "never reinterpret already-frozen reports" plus the
 * completion handoff's "retain the recorded timezone of existing periods."
 */
export async function getOwnerTimezone(db: Database, ownerId: string): Promise<string> {
  const stored = await getOwnerPlanningTimezone(db, ownerId);
  return stored ?? DEFAULT_PLANNING_TIMEZONE;
}

/**
 * Finds this week's (Monday-start, DEFAULT_PLANNING_TIMEZONE) planning_weeks row, creating it if
 * this is the first time it's been touched. A GET-triggered write, same precedent as
 * board-store.ts's getBoard() lazy backfills (see roadmap's evidence section) - idempotent and
 * additive, not a domain mutation an owner would need to review. A duplicate-insert race (two
 * concurrent first-touches) is resolved by falling back to a re-read: `planning_weeks` has a
 * unique `(owner_id, start_date)` index, so the loser's insert fails and it just uses the
 * winner's row instead of erroring.
 */
export async function getOrCreateCurrentPlanningWeek(db: Database, ownerId: string, timezone: string = DEFAULT_PLANNING_TIMEZONE): Promise<PlanningWeekRow> {
  const startDate = mondayStartOf(new Date(), timezone);
  const existing = await findPlanningWeekByStartDate(db, ownerId, startDate);
  if (existing) return existing;
  try {
    await createPlanningWeek(db, ownerId, `week_${startDate}`, startDate, timezone);
  } catch {
    // Lost the race to a concurrent first-touch - fall through to the re-read below.
  }
  const row = await findPlanningWeekByStartDate(db, ownerId, startDate);
  if (!row) throw new Error("Failed to create or find this week's planning week.");
  return row;
}

/**
 * The live (not-yet-frozen) statistics for an open/closing week, or the frozen snapshot for a
 * closed one. Shared by commands.ts's weekClosePlan (which computes the live version once more,
 * right before freezing it) and the GET /api/board read path (which shows it as-is, continuously,
 * while the week is still open) - one implementation of "replay this week's commit/withdraw and
 * complete/reopen history," not two.
 */
export async function computeCurrentWeekStats(db: Database, ownerId: string, week: Pick<PlanningWeekRow, "id" | "start_date" | "timezone" | "status" | "report_json">): Promise<PeriodStats> {
  if (week.status === "closed") {
    return JSON.parse(week.report_json ?? "null") as PeriodStats;
  }
  const commitments = await listWeekCommitments(db, ownerId, week.id);
  const itemIds = commitments.map((commitment) => commitment.item_id);
  const itemRows = await Promise.all(itemIds.map((id) => findItemRow(db, ownerId, id)));
  const itemsById: Record<string, { itemType: string }> = {};
  itemRows.forEach((row, index) => {
    if (row) itemsById[itemIds[index]] = { itemType: row.item_type };
  });
  const allEvents = await listActivityEventsForItems(db, ownerId, itemIds, ["items.complete", "items.reopen", "week.commit", "week.withdraw"]);
  const statusEvents = allEvents.filter((event): event is typeof event & { event_type: "items.complete" | "items.reopen" } =>
    event.event_type === "items.complete" || event.event_type === "items.reopen",
  );
  // Same per-week scoping as commands.ts's weekClosePlan - see that function's comment for why
  // (the same item can be committed to multiple different weeks independently).
  const commitmentEvents = allEvents.filter((event): event is typeof event & { event_type: "week.commit" | "week.withdraw" } => {
    if (event.event_type !== "week.commit" && event.event_type !== "week.withdraw") return false;
    const after = event.after_json ? (JSON.parse(event.after_json) as { weekId?: string }) : null;
    return after?.weekId === week.id;
  });

  return computePeriodStats({
    period: { startDate: week.start_date, endDate: weekEndDate(week.start_date), timezone: week.timezone },
    commitments: commitments.map((commitment) => ({ itemId: commitment.item_id, withdrawnAt: commitment.withdrawn_at })),
    itemsById,
    events: statusEvents.map((event) => ({ itemId: event.entity_id, eventType: event.event_type, timestamp: event.timestamp })),
    commitmentEvents: commitmentEvents.map((event) => ({ itemId: event.entity_id, eventType: event.event_type, timestamp: event.timestamp })),
  });
}

export type WeekCommitmentDisplay = {
  itemId: string;
  title: string;
  itemType: string;
  status: string;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
};

export type WeekProgress = {
  weekId: string;
  startDate: string;
  timezone: string;
  status: string;
  stats: PeriodStats;
  commitments: WeekCommitmentDisplay[];
};

/** Everything the weekly-progress UI needs for one week: live or frozen stats, plus each
 * committed item's display fields (title/type/status - deleted-item rows fall back to a
 * placeholder rather than being silently dropped, since the commitment/history still exists). */
export async function getWeekProgress(db: Database, ownerId: string, week: PlanningWeekRow): Promise<WeekProgress> {
  const commitmentRows = await listWeekCommitments(db, ownerId, week.id);
  const itemRows = await Promise.all(commitmentRows.map((commitment) => findItemRow(db, ownerId, commitment.item_id)));
  const stats = await computeCurrentWeekStats(db, ownerId, week);
  const commitments: WeekCommitmentDisplay[] = commitmentRows.map((commitment, index) => {
    const item = itemRows[index];
    return {
      itemId: commitment.item_id,
      title: item?.title ?? "(deleted item)",
      itemType: item?.item_type ?? "Task",
      status: item?.status ?? "Done",
      withdrawnAt: commitment.withdrawn_at,
      withdrawalReason: commitment.withdrawal_reason,
    };
  });
  return { weekId: week.id, startDate: week.start_date, timezone: week.timezone, status: week.status, stats, commitments };
}

/**
 * Phase 3 completion: a bounded, owner-scoped, most-recent-first summary list of every planning
 * week the owner has touched (open or closed) - the missing read side of "a prior week's frozen
 * report survives in planning_weeks but drops out of the browser after rollover" (completion
 * handoff). Summaries only (id/date/status, no stats) - a selector's worth of data, not a report;
 * callers fetch one week's full getWeekProgress only after the owner picks it.
 */
export async function listRecentPlanningWeeks(db: Database, ownerId: string, limit: number = LIMITS.maxPlanningWeekHistory): Promise<PlanningWeekSummary[]> {
  return listPlanningWeeks(db, ownerId, limit);
}

/** Looks up an arbitrary owner-scoped week by ID (current or historical) and returns its full
 * progress - the read half of letting the owner inspect/close a prior week, not just the current
 * one. Returns null for an unknown or not-owned ID, same not-found-not-forbidden shape the
 * roadmap's API contract uses elsewhere. */
export async function getPlanningWeekProgressById(db: Database, ownerId: string, weekId: string): Promise<WeekProgress | null> {
  const week = await findPlanningWeek(db, ownerId, weekId);
  if (!week) return null;
  return getWeekProgress(db, ownerId, week);
}

// --- Phase 3 extension: Today/Month/Year periods -------------------------------------------
// Same shape as the week functions above, reused generically across period types rather than
// duplicated per type - see db/schema.ts's planningPeriods comment and
// docs/adr/local/time-horizon-quick-actions.md for why this is a separate system from weekly.

/**
 * Same find-or-create-with-race-fallback pattern as getOrCreateCurrentPlanningWeek, picking the
 * boundary via lib/domain/progress.ts's periodStartOf/periodEndDate by period type.
 */
export async function getOrCreateCurrentPlanningPeriod(db: Database, ownerId: string, periodType: PeriodType, timezone: string = DEFAULT_PLANNING_TIMEZONE): Promise<PlanningPeriodRow> {
  const startDate = periodStartOf(periodType, new Date(), timezone);
  const existing = await findPlanningPeriodByTypeAndStart(db, ownerId, periodType, startDate);
  if (existing) return existing;
  const endDate = periodEndDate(periodType, startDate);
  try {
    await createPlanningPeriod(db, ownerId, `${periodType}_${startDate}`, periodType, startDate, endDate, timezone);
  } catch {
    // Lost the race to a concurrent first-touch - fall through to the re-read below.
  }
  const row = await findPlanningPeriodByTypeAndStart(db, ownerId, periodType, startDate);
  if (!row) throw new Error(`Failed to create or find the current ${periodType} period.`);
  return row;
}

/**
 * Same shape as computeCurrentWeekStats, minus the closed/frozen-snapshot branch - v1 periods
 * never close (see commands.ts's periodCommitPlan comment), so this always computes live. The
 * live computation is already correctly time-bounded against the period's own end instant (see
 * lib/domain/progress.ts's completionAsOf), so an unclosed period still reports late completions
 * correctly - closing isn't needed for correctness, only as a future optional freeze/optimization.
 */
export async function computeCurrentPeriodStats(db: Database, ownerId: string, period: Pick<PlanningPeriodRow, "id" | "start_date" | "end_date" | "timezone">): Promise<PeriodStats> {
  const commitments = await listPeriodCommitments(db, ownerId, period.id);
  const itemIds = commitments.map((commitment) => commitment.item_id);
  const itemRows = await Promise.all(itemIds.map((id) => findItemRow(db, ownerId, id)));
  const itemsById: Record<string, { itemType: string }> = {};
  itemRows.forEach((row, index) => {
    if (row) itemsById[itemIds[index]] = { itemType: row.item_type };
  });
  const allEvents = await listActivityEventsForItems(db, ownerId, itemIds, ["items.complete", "items.reopen", "period.commit", "period.withdraw"]);
  const statusEvents = allEvents.filter((event): event is typeof event & { event_type: "items.complete" | "items.reopen" } =>
    event.event_type === "items.complete" || event.event_type === "items.reopen",
  );
  // Scoped to this specific period the same way computeCurrentWeekStats scopes to one week - the
  // same item can be committed to multiple different periods (and period types) independently.
  const commitmentEvents = allEvents.filter((event): event is typeof event & { event_type: "period.commit" | "period.withdraw" } => {
    if (event.event_type !== "period.commit" && event.event_type !== "period.withdraw") return false;
    const after = event.after_json ? (JSON.parse(event.after_json) as { periodId?: string }) : null;
    return after?.periodId === period.id;
  });

  return computePeriodStats({
    period: { startDate: period.start_date, endDate: period.end_date, timezone: period.timezone },
    commitments: commitments.map((commitment) => ({ itemId: commitment.item_id, withdrawnAt: commitment.withdrawn_at })),
    itemsById,
    events: statusEvents.map((event) => ({ itemId: event.entity_id, eventType: event.event_type, timestamp: event.timestamp })),
    commitmentEvents: commitmentEvents.map((event) => ({ itemId: event.entity_id, eventType: event.event_type, timestamp: event.timestamp })),
  });
}

export type PeriodCommitmentDisplay = {
  itemId: string;
  title: string;
  itemType: string;
  status: string;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
};

export type PeriodProgress = {
  periodId: string;
  periodType: PeriodType;
  startDate: string;
  timezone: string;
  status: string;
  stats: PeriodStats;
  commitments: PeriodCommitmentDisplay[];
};

/** Same shape as getWeekProgress, for a generic Today/Month/Year period. */
export async function getPeriodProgress(db: Database, ownerId: string, period: PlanningPeriodRow): Promise<PeriodProgress> {
  const commitmentRows = await listPeriodCommitments(db, ownerId, period.id);
  const itemRows = await Promise.all(commitmentRows.map((commitment) => findItemRow(db, ownerId, commitment.item_id)));
  const stats = await computeCurrentPeriodStats(db, ownerId, period);
  const commitments: PeriodCommitmentDisplay[] = commitmentRows.map((commitment, index) => {
    const item = itemRows[index];
    return {
      itemId: commitment.item_id,
      title: item?.title ?? "(deleted item)",
      itemType: item?.item_type ?? "Task",
      status: item?.status ?? "Done",
      withdrawnAt: commitment.withdrawn_at,
      withdrawalReason: commitment.withdrawal_reason,
    };
  });
  return { periodId: period.id, periodType: period.period_type as PeriodType, startDate: period.start_date, timezone: period.timezone, status: period.status, stats, commitments };
}

export type FocusItemDisplay = {
  itemId: string;
  title: string;
  status: string;
  priority: number | null;
  selectedAt: string;
  reviewUntil: string | null;
};

/** Focus rows enriched with the fields the UI displays - deleted-item rows are dropped rather
 * than shown as placeholders, since Focus (unlike a week's commitments) has no historical
 * denominator that needs the row to remain visible. */
export async function getFocusItems(db: Database, ownerId: string): Promise<FocusItemDisplay[]> {
  const rows: FocusItemRow[] = await listFocusItems(db, ownerId);
  const itemRows = await Promise.all(rows.map((row) => findItemRow(db, ownerId, row.item_id)));
  const results: FocusItemDisplay[] = [];
  rows.forEach((row, index) => {
    const item = itemRows[index];
    if (!item) return;
    results.push({ itemId: row.item_id, title: item.title, status: item.status, priority: item.priority, selectedAt: row.selected_at, reviewUntil: row.review_until });
  });
  return results;
}
