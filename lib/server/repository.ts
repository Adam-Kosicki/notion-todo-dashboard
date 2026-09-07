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

export async function appendActivityEvent(
  db: Database,
  event: {
    id: string;
    ownerId: string;
    entityId: string;
    actorKind: string;
    eventType: string;
    requestId: string | null;
    before: unknown;
    after: unknown;
  },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO activity_events (id, owner_id, entity_id, actor_kind, event_type, request_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
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
    )
    .run();
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

export async function setFocusItem(db: Database, ownerId: string, itemId: string, reviewUntil: string | null): Promise<void> {
  await db
    .prepare(
      `INSERT INTO focus_items (owner_id, item_id, selected_at, review_until) VALUES (?, ?, CURRENT_TIMESTAMP, ?)
       ON CONFLICT (owner_id, item_id) DO UPDATE SET review_until = excluded.review_until`,
    )
    .bind(ownerId, itemId, reviewUntil)
    .run();
}

export async function removeFocusItem(db: Database, ownerId: string, itemId: string): Promise<void> {
  await db.prepare("DELETE FROM focus_items WHERE owner_id = ? AND item_id = ?").bind(ownerId, itemId).run();
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

export async function closePlanningWeekRow(db: Database, ownerId: string, id: string, reportJson: string): Promise<void> {
  await db
    .prepare("UPDATE planning_weeks SET status = 'closed', report_json = ? WHERE owner_id = ? AND id = ?")
    .bind(reportJson, ownerId, id)
    .run();
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

export async function addWeekCommitment(db: Database, ownerId: string, weekId: string, itemId: string): Promise<void> {
  await db
    .prepare("INSERT INTO week_commitments (owner_id, week_id, item_id, added_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)")
    .bind(ownerId, weekId, itemId)
    .run();
}

export async function withdrawWeekCommitment(db: Database, ownerId: string, weekId: string, itemId: string, reason: string | null): Promise<void> {
  await db
    .prepare("UPDATE week_commitments SET withdrawn_at = CURRENT_TIMESTAMP, withdrawal_reason = ? WHERE owner_id = ? AND week_id = ? AND item_id = ?")
    .bind(reason, ownerId, weekId, itemId)
    .run();
}

export type ActivityEventRow = { entity_id: string; event_type: string; timestamp: string };

/** Used by weekClose to reconstruct each committed item's complete/reopen history for computeWeekStats. */
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
      `SELECT entity_id, event_type, timestamp FROM activity_events
       WHERE owner_id = ? AND entity_id IN (${itemPlaceholders}) AND event_type IN (${typePlaceholders})
       ORDER BY timestamp ASC`,
    )
    .bind(ownerId, ...itemIds, ...eventTypes)
    .all<ActivityEventRow>();
  return result.results;
}
