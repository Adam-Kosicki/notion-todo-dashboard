// Phase 1 (docs/plans/burner-board-roadmap.md): D1 SQL for the new phase-1 tables
// (board_state, command_receipts, activity_events) and the new item columns
// (list_id, version, deleted_at, review_state, created_at*, recorded_at).
//
// Deliberately takes `db: Database` as a parameter rather than importing `cloudflare:workers`
// itself. That module only exists inside a real Workers isolate - importing it from a plain
// `node --test` file throws `ERR_UNSUPPORTED_ESM_URL_SCHEME` (the same error behind one of the
// two pre-existing test failures noted in the Phase 0 handoff). Keeping this module runtime-
// agnostic is what makes tests/commands.test.mjs possible: it injects a small node:sqlite-backed
// adapter (tests/helpers/d1.mjs's asD1()) instead of the real binding. A real D1Database already
// satisfies this Database interface structurally - no adapter needed at call sites in `app/`.
import type { StorageMode } from "@/lib/domain/contracts";

export interface PreparedStatement {
  bind(...args: unknown[]): PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}
export interface Database {
  prepare(sql: string): PreparedStatement;
  batch(statements: PreparedStatement[]): Promise<Array<{ meta: { changes: number } }>>;
}

export type ItemRow = {
  owner_id: string;
  id: string;
  title: string;
  status: string;
  item_type: string;
  priority: number | null;
  collection: string | null;
  list_id: string | null;
  group_id: string | null;
  version: number;
  deleted_at: string | null;
  review_state: string | null;
  completed_at: string | null;
  created_at: string | null;
  created_at_source: string | null;
  recorded_at: string;
  updated_at: string;
};

export type ListRow = { owner_id: string; id: string; name: string };

export async function getBoardState(db: Database, ownerId: string): Promise<{ revision: number; storageMode: StorageMode }> {
  const row = await db
    .prepare("SELECT revision, storage_mode FROM board_state WHERE owner_id = ?")
    .bind(ownerId)
    .first<{ revision: number; storage_mode: StorageMode }>();
  if (!row) return { revision: 0, storageMode: "legacy_notion" };
  return { revision: Number(row.revision), storageMode: row.storage_mode };
}

export async function ensureBoardState(db: Database, ownerId: string): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO board_state (owner_id, revision, storage_mode) VALUES (?, 0, 'legacy_notion')")
    .bind(ownerId)
    .run();
}

export async function setStorageMode(db: Database, ownerId: string, mode: StorageMode): Promise<void> {
  await ensureBoardState(db, ownerId);
  await db
    .prepare("UPDATE board_state SET storage_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE owner_id = ?")
    .bind(mode, ownerId)
    .run();
}

/** Increments and returns the new revision. Caller must have called ensureBoardState first (or rely on this doing it). */
export async function bumpBoardRevision(db: Database, ownerId: string): Promise<number> {
  await ensureBoardState(db, ownerId);
  await db
    .prepare("UPDATE board_state SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE owner_id = ?")
    .bind(ownerId)
    .run();
  const state = await getBoardState(db, ownerId);
  return state.revision;
}

export async function getReceipt(
  db: Database,
  ownerId: string,
  requestId: string,
): Promise<{ payloadHash: string; committedRevision: number; resultJson: string } | null> {
  const row = await db
    .prepare("SELECT payload_hash, committed_revision, result_json FROM command_receipts WHERE owner_id = ? AND request_id = ?")
    .bind(ownerId, requestId)
    .first<{ payload_hash: string; committed_revision: number; result_json: string }>();
  if (!row) return null;
  return { payloadHash: row.payload_hash, committedRevision: row.committed_revision, resultJson: row.result_json };
}

export async function saveReceipt(
  db: Database,
  ownerId: string,
  requestId: string,
  payloadHash: string,
  committedRevision: number,
  resultJson: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO command_receipts (owner_id, request_id, payload_hash, committed_revision, result_json) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(ownerId, requestId, payloadHash, committedRevision, resultJson)
    .run();
}

/**
 * Astra review (Phase 3 Slice 1, c02e352): the weekly statistics contract (lib/domain/progress.ts)
 * compares event timestamps against real UTC instants, which requires every activity_events row
 * to actually be in ISO-8601 format ("...T...Z"). SQLite's own `CURRENT_TIMESTAMP` column default
 * produces "YYYY-MM-DD HH:MM:SS" instead - a space, not "T", at the same position - which sorts
 * as LESS than any same-day ISO instant (' ' < 'T' in ASCII) regardless of actual time of day.
 * Always bind an app-computed `timestamp` explicitly; never rely on the column default.
 */
export type ActivityEventInput = {
  id: string;
  ownerId: string;
  entityId: string;
  actorKind: string;
  eventType: string;
  requestId: string | null;
  before: unknown;
  after: unknown;
  timestamp: string;
};

export function appendActivityEventStmt(db: Database, event: ActivityEventInput): PreparedStatement {
  return db
    .prepare(
      "INSERT INTO activity_events (id, owner_id, entity_id, actor_kind, event_type, request_id, before_json, after_json, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      event.id,
      event.ownerId,
      event.entityId,
      event.actorKind,
      event.eventType,
      event.requestId,
      event.before === undefined ? null : JSON.stringify(event.before),
      event.after === undefined ? null : JSON.stringify(event.after),
      event.timestamp,
    );
}

export async function appendActivityEvent(db: Database, event: ActivityEventInput): Promise<void> {
  await appendActivityEventStmt(db, event).run();
}

/**
 * Astra review (remediation round, 7060176^..1698bc8, P1#3): commands.ts's applyAtomicPlan
 * previously computed the reported/receipted board revision as `boardRevisionBefore + 1` from an
 * earlier read, while the actual SQL did a relative `revision = revision + 1` with no guard tying
 * it to that same read - two concurrent commands for the same owner could both read revision 0,
 * both compute "1", and both report/receipt "1" while the database actually reached 2. Folding
 * this fragment into every statement in an atomic plan (bookkeeping AND the domain mutation
 * itself) makes the whole plan a no-op together if the owner's revision moved since it was read,
 * so a successful plan's `boardRevisionBefore + 1` is guaranteed correct rather than assumed.
 */
export function revisionGuard(ownerId: string, expectedBoardRevision: number): { sql: string; params: unknown[] } {
  return { sql: "EXISTS (SELECT 1 FROM board_state WHERE owner_id = ? AND revision = ?)", params: [ownerId, expectedBoardRevision] };
}

export async function findItemRow(db: Database, ownerId: string, id: string): Promise<ItemRow | null> {
  return db.prepare("SELECT * FROM items WHERE owner_id = ? AND id = ?").bind(ownerId, id).first<ItemRow>();
}

export async function findListRow(db: Database, ownerId: string, id: string): Promise<ListRow | null> {
  return db.prepare("SELECT owner_id, id, name FROM lists WHERE owner_id = ? AND id = ?").bind(ownerId, id).first<ListRow>();
}

export async function findListByName(db: Database, ownerId: string, name: string): Promise<ListRow | null> {
  return db.prepare("SELECT owner_id, id, name FROM lists WHERE owner_id = ? AND name = ?").bind(ownerId, name).first<ListRow>();
}

// --- Phase 3: Focus and weekly commitments (not gated by storage_mode - see commands.ts) ---

export type FocusItemRow = { owner_id: string; item_id: string; selected_at: string; review_until: string | null };

export async function listFocusItems(db: Database, ownerId: string): Promise<FocusItemRow[]> {
  const result = await db.prepare("SELECT * FROM focus_items WHERE owner_id = ? ORDER BY selected_at DESC").bind(ownerId).all<FocusItemRow>();
  return result.results;
}

export function setFocusItemStmt(db: Database, ownerId: string, itemId: string, reviewUntil: string | null, now: string, expectedBoardRevision: number): PreparedStatement {
  const guard = revisionGuard(ownerId, expectedBoardRevision);
  return db
    .prepare(
      `INSERT INTO focus_items (owner_id, item_id, selected_at, review_until)
       SELECT ?, ?, ?, ? WHERE ${guard.sql}
       ON CONFLICT (owner_id, item_id) DO UPDATE SET review_until = excluded.review_until`,
    )
    .bind(ownerId, itemId, now, reviewUntil, ...guard.params);
}

export function removeFocusItemStmt(db: Database, ownerId: string, itemId: string, expectedBoardRevision: number): PreparedStatement {
  const guard = revisionGuard(ownerId, expectedBoardRevision);
  return db.prepare(`DELETE FROM focus_items WHERE owner_id = ? AND item_id = ? AND ${guard.sql}`).bind(ownerId, itemId, ...guard.params);
}

export type PlanningWeekRow = {
  owner_id: string;
  id: string;
  start_date: string;
  timezone: string;
  status: string;
  report_json: string | null;
};

export async function findPlanningWeek(db: Database, ownerId: string, id: string): Promise<PlanningWeekRow | null> {
  return db.prepare("SELECT * FROM planning_weeks WHERE owner_id = ? AND id = ?").bind(ownerId, id).first<PlanningWeekRow>();
}

export async function findPlanningWeekByStartDate(db: Database, ownerId: string, startDate: string): Promise<PlanningWeekRow | null> {
  return db.prepare("SELECT * FROM planning_weeks WHERE owner_id = ? AND start_date = ?").bind(ownerId, startDate).first<PlanningWeekRow>();
}

export async function createPlanningWeek(db: Database, ownerId: string, id: string, startDate: string, timezone: string): Promise<void> {
  await db
    .prepare("INSERT INTO planning_weeks (owner_id, id, start_date, timezone, status) VALUES (?, ?, ?, ?, 'open')")
    .bind(ownerId, id, startDate, timezone)
    .run();
}

/**
 * Astra review (Phase 3 Slice 1, c02e352, Blocker B): compare-and-swap 'open' -> 'closing'.
 * This is the exclusive lock that stops week.commit/week.withdraw (both guarded on status =
 * 'open') from racing a concurrent week.close's read-compute-freeze sequence - see commands.ts's
 * weekClose. Returns false if some other request already holds it (or already finished
 * closing); the caller re-reads the row to find out which.
 */
export async function beginClosingPlanningWeek(db: Database, ownerId: string, id: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE planning_weeks SET status = 'closing' WHERE owner_id = ? AND id = ? AND status = 'open'")
    .bind(ownerId, id)
    .run();
  return result.meta.changes > 0;
}

/** Finalizes a close: only takes effect while this row still holds the 'closing' lock AND the
 * owner's board revision hasn't moved since it was read, so it's safe to include (guarded the
 * same way) in the same atomic batch as the revision bump, activity event, and receipt - see
 * commands.ts's applyAtomicPlan. */
export function finalizeClosedPlanningWeekStmt(db: Database, ownerId: string, id: string, reportJson: string, expectedBoardRevision: number): PreparedStatement {
  const guard = revisionGuard(ownerId, expectedBoardRevision);
  return db
    .prepare(`UPDATE planning_weeks SET status = 'closed', report_json = ? WHERE owner_id = ? AND id = ? AND status = 'closing' AND ${guard.sql}`)
    .bind(reportJson, ownerId, id, ...guard.params);
}

export type WeekCommitmentRow = {
  owner_id: string;
  week_id: string;
  item_id: string;
  added_at: string;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
};

export async function findWeekCommitment(db: Database, ownerId: string, weekId: string, itemId: string): Promise<WeekCommitmentRow | null> {
  return db
    .prepare("SELECT * FROM week_commitments WHERE owner_id = ? AND week_id = ? AND item_id = ?")
    .bind(ownerId, weekId, itemId)
    .first<WeekCommitmentRow>();
}

export async function listWeekCommitments(db: Database, ownerId: string, weekId: string): Promise<WeekCommitmentRow[]> {
  const result = await db
    .prepare("SELECT * FROM week_commitments WHERE owner_id = ? AND week_id = ?")
    .bind(ownerId, weekId)
    .all<WeekCommitmentRow>();
  return result.results;
}

/**
 * Astra review (Phase 3 Slice 1, c02e352, Blocker B; revision guard added in the remediation
 * round, 7060176^..1698bc8, P1#3): the commit is database-enforced against both a concurrently
 * closing week AND a concurrently moved board revision (rather than relying on the caller's own
 * pre-read staying true for either). Also handles re-adding a previously withdrawn commitment
 * (the roadmap's phase-3 acceptance criteria explicitly require add/withdraw/re-add): the upsert
 * clears any prior withdrawal and refreshes `added_at` to now for display purposes - on-time
 * credit no longer depends on this column (see lib/domain/progress.ts's computeWeekStats, which
 * replays the full week.commit/week.withdraw event history instead). Returns an unexecuted
 * statement so commands.ts can run it in the same atomic batch as the revision bump/activity
 * event/receipt - see applyAtomicPlan.
 */
export function upsertWeekCommitmentStmt(db: Database, ownerId: string, weekId: string, itemId: string, now: string, expectedBoardRevision: number): PreparedStatement {
  const guard = revisionGuard(ownerId, expectedBoardRevision);
  return db
    .prepare(
      `INSERT INTO week_commitments (owner_id, week_id, item_id, added_at)
       SELECT ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM planning_weeks WHERE owner_id = ? AND id = ? AND status = 'open') AND ${guard.sql}
       ON CONFLICT (owner_id, week_id, item_id) DO UPDATE SET withdrawn_at = NULL, withdrawal_reason = NULL, added_at = excluded.added_at`,
    )
    .bind(ownerId, weekId, itemId, now, ownerId, weekId, ...guard.params);
}

/** Same database-enforced "week must still be open" + board-revision guard as
 * upsertWeekCommitmentStmt. `withdrawn_at IS NULL` is part of this statement's own precondition -
 * see commands.ts's weekWithdrawPlan for why the bookkeeping statements must check the identical
 * condition (Astra P1#2: they previously only checked the week-open half of it). */
export function withdrawWeekCommitmentStmt(db: Database, ownerId: string, weekId: string, itemId: string, reason: string | null, now: string, expectedBoardRevision: number): PreparedStatement {
  const guard = revisionGuard(ownerId, expectedBoardRevision);
  return db
    .prepare(
      `UPDATE week_commitments SET withdrawn_at = ?, withdrawal_reason = ?
       WHERE owner_id = ? AND week_id = ? AND item_id = ? AND withdrawn_at IS NULL
       AND EXISTS (SELECT 1 FROM planning_weeks WHERE owner_id = ? AND id = ? AND status = 'open') AND ${guard.sql}`,
    )
    .bind(now, reason, ownerId, weekId, itemId, ownerId, weekId, ...guard.params);
}

// --- Phase 3 extension: generic Today/Month/Year periods -----------------------------------
// Mirrors the planning_weeks/week_commitments functions above exactly, one table pair for all
// three period types (period_type is data, not a code branch) - see db/schema.ts's
// planningPeriods/periodCommitments comment for why this stays a separate table pair from
// planning_weeks rather than unifying with it. No 'closing' transition/finalize-close statement
// yet - v1 periods never close (see commands.ts's periodCommitPlan comment).

export type PlanningPeriodRow = {
  owner_id: string;
  id: string;
  period_type: string;
  start_date: string;
  end_date: string;
  timezone: string;
  status: string;
};

export async function findPlanningPeriod(db: Database, ownerId: string, id: string): Promise<PlanningPeriodRow | null> {
  return db.prepare("SELECT * FROM planning_periods WHERE owner_id = ? AND id = ?").bind(ownerId, id).first<PlanningPeriodRow>();
}

export async function findPlanningPeriodByTypeAndStart(db: Database, ownerId: string, periodType: string, startDate: string): Promise<PlanningPeriodRow | null> {
  return db
    .prepare("SELECT * FROM planning_periods WHERE owner_id = ? AND period_type = ? AND start_date = ?")
    .bind(ownerId, periodType, startDate)
    .first<PlanningPeriodRow>();
}

export async function createPlanningPeriod(db: Database, ownerId: string, id: string, periodType: string, startDate: string, endDate: string, timezone: string): Promise<void> {
  await db
    .prepare("INSERT INTO planning_periods (owner_id, id, period_type, start_date, end_date, timezone, status) VALUES (?, ?, ?, ?, ?, ?, 'open')")
    .bind(ownerId, id, periodType, startDate, endDate, timezone)
    .run();
}

export type PeriodCommitmentRow = {
  owner_id: string;
  period_id: string;
  item_id: string;
  added_at: string;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
};

export async function findPeriodCommitment(db: Database, ownerId: string, periodId: string, itemId: string): Promise<PeriodCommitmentRow | null> {
  return db
    .prepare("SELECT * FROM period_commitments WHERE owner_id = ? AND period_id = ? AND item_id = ?")
    .bind(ownerId, periodId, itemId)
    .first<PeriodCommitmentRow>();
}

export async function listPeriodCommitments(db: Database, ownerId: string, periodId: string): Promise<PeriodCommitmentRow[]> {
  const result = await db
    .prepare("SELECT * FROM period_commitments WHERE owner_id = ? AND period_id = ?")
    .bind(ownerId, periodId)
    .all<PeriodCommitmentRow>();
  return result.results;
}

/** Same shape as upsertWeekCommitmentStmt: database-enforced "period must still be open" + board-revision guard, and handles re-adding a withdrawn commitment. */
export function upsertPeriodCommitmentStmt(db: Database, ownerId: string, periodId: string, itemId: string, now: string, expectedBoardRevision: number): PreparedStatement {
  const guard = revisionGuard(ownerId, expectedBoardRevision);
  return db
    .prepare(
      `INSERT INTO period_commitments (owner_id, period_id, item_id, added_at)
       SELECT ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM planning_periods WHERE owner_id = ? AND id = ? AND status = 'open') AND ${guard.sql}
       ON CONFLICT (owner_id, period_id, item_id) DO UPDATE SET withdrawn_at = NULL, withdrawal_reason = NULL, added_at = excluded.added_at`,
    )
    .bind(ownerId, periodId, itemId, now, ownerId, periodId, ...guard.params);
}

/** Same shape as withdrawWeekCommitmentStmt, including `withdrawn_at IS NULL` as part of this statement's own precondition (see commands.ts's periodWithdrawPlan for why the bookkeeping guard must match exactly). */
export function withdrawPeriodCommitmentStmt(db: Database, ownerId: string, periodId: string, itemId: string, reason: string | null, now: string, expectedBoardRevision: number): PreparedStatement {
  const guard = revisionGuard(ownerId, expectedBoardRevision);
  return db
    .prepare(
      `UPDATE period_commitments SET withdrawn_at = ?, withdrawal_reason = ?
       WHERE owner_id = ? AND period_id = ? AND item_id = ? AND withdrawn_at IS NULL
       AND EXISTS (SELECT 1 FROM planning_periods WHERE owner_id = ? AND id = ? AND status = 'open') AND ${guard.sql}`,
    )
    .bind(now, reason, ownerId, periodId, itemId, ownerId, periodId, ...guard.params);
}

/**
 * Astra review (round 2 re-review): `after_json` is included specifically so callers can recover
 * `weekId` for week.commit/week.withdraw rows (see commands.ts's weekClosePlan) - entity_id is the
 * ITEM id for these event types, not the week, since the same item can be committed to multiple
 * different planning weeks independently (week_commitments' primary key is
 * (owner_id, week_id, item_id)). Querying by item id alone is therefore not enough to reconstruct
 * one specific week's own commit/withdraw history.
 */
export type ActivityEventRow = { entity_id: string; event_type: string; timestamp: string; after_json: string | null };

/** Used by weekClose to reconstruct each committed item's complete/reopen AND commit/withdraw
 * history for computeWeekStats (pass the relevant eventTypes for each; entity_id is the item ID
 * for both categories, so one call covers both - see commands.ts's weekClosePlan). Returns every
 * matching event regardless of which week a week.commit/week.withdraw row belongs to - the caller
 * must filter commit/withdraw rows to the week being closed using `after_json`'s `weekId`. */
export async function listActivityEventsForItems(
  db: Database,
  ownerId: string,
  itemIds: string[],
  eventTypes: string[],
): Promise<ActivityEventRow[]> {
  if (itemIds.length === 0) return [];
  const itemPlaceholders = itemIds.map(() => "?").join(",");
  const typePlaceholders = eventTypes.map(() => "?").join(",");
  const result = await db
    .prepare(
      `SELECT entity_id, event_type, timestamp, after_json FROM activity_events
       WHERE owner_id = ? AND entity_id IN (${itemPlaceholders}) AND event_type IN (${typePlaceholders})
       ORDER BY timestamp ASC`,
    )
    .bind(ownerId, ...itemIds, ...eventTypes)
    .all<ActivityEventRow>();
  return result.results;
}
