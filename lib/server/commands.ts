// Phase 1 (docs/plans/burner-board-roadmap.md, section 7): the single mutation entry point
// for the new command envelope. Enforces preconditions, idempotency, audit events, and atomic
// persistence per command.
//
// Scope decision for Phase 1 (routine engineering choice, not escalated): the items.*/lists.*
// handlers are NOT wired into app/api/board/route.ts yet. They're fully built and tested in
// isolation against the synthetic D1 harness (tests/commands.test.mjs), reachable once a later
// phase actually flips an owner's storage_mode to "d1_primary" and routes requests through it.
// The real owner stays on the existing legacy_notion path (board-store.ts, unchanged) until the
// phase 4 cutover gate. This keeps Phase 1 zero-risk to the live app while still proving the
// new layer works end to end.
//
// Phase 3 amends this: focus.*/week.* commands are exempt from the d1_primary gate (see
// requiresD1Primary below) since Focus/weekly-commitments have no Notion equivalent at all -
// same category as Groups. They're reachable for every owner today, items./lists. gating is
// unchanged.
//
// D1-primary invariant: this file has no Notion import and makes no network call anywhere in
// it. That's not a runtime check - it's true by construction, which is the simplest possible
// guarantee that "d1_primary mode never invokes Notion." (Also true, trivially, for the
// ungated focus.*/week.* commands - they don't touch Notion either.)
import {
  COMMAND_SCHEMAS,
  CommandError,
  ERROR_STATUS,
  type CommandAction,
  type CommandEnvelope,
  type CommandResult,
  type FocusSetInput,
  type ItemsCompleteInput,
  type ItemsCreateInput,
  type ItemsDeleteInput,
  type ItemsMoveInput,
  type ItemsReopenInput,
  type ItemsRestoreInput,
  type ItemsReviewInput,
  type ItemsUpdateInput,
  type ListsCreateInput,
  type ListsDeleteInput,
  type ListsUpdateInput,
  type WeekCloseInput,
  type WeekCommitInput,
  type WeekWithdrawInput,
  isKnownCommand,
} from "@/lib/domain/contracts";
import type { WeekStats } from "@/lib/domain/progress";
import {
  appendActivityEvent,
  beginClosingPlanningWeek,
  bumpBoardRevision,
  ensureBoardState,
  finalizeClosedPlanningWeekStmt,
  findItemRow,
  findListByName,
  findListRow,
  findPlanningWeek,
  findWeekCommitment,
  getBoardState,
  getReceipt,
  removeFocusItemStmt,
  revisionGuard,
  saveReceipt,
  setFocusItemStmt,
  upsertWeekCommitmentStmt,
  withdrawWeekCommitmentStmt,
  type Database,
  type ItemRow,
  type PreparedStatement,
} from "@/lib/server/repository";
import { computeCurrentWeekStats } from "@/lib/server/queries";

export { ERROR_STATUS };

/** Small, stable, non-cryptographic hash - only used to detect "same request ID, different payload." */
function hashPayload(payload: unknown): string {
  const stable = stableStringify(payload);
  let hash = 5381;
  for (let i = 0; i < stable.length; i++) {
    hash = ((hash << 5) + hash + stable.charCodeAt(i)) | 0;
  }
  return hash.toString(16);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

type HandlerOutcome<T> = {
  result: T;
  changedItemIds: string[];
  changedListIds: string[];
  activity: Array<{ entityId: string; eventType: string; before: unknown; after: unknown }>;
};

async function requireD1Primary(db: Database, ownerId: string): Promise<number> {
  const state = await getBoardState(db, ownerId);
  if (state.storageMode !== "d1_primary") {
    throw new CommandError("FORBIDDEN", "This owner is not in d1_primary storage mode yet.");
  }
  return state.revision;
}

// Phase 3: items.*/lists.* are Notion-synced legacy data, so they stay gated behind the phase 4
// cutover as Phase 1 established. focus.*/week.* have no Notion equivalent at all (same category
// as Groups - see db/schema.ts's focusItems comment), so they're exempt from that gate and work
// for a legacy_notion owner today. Board-revision tracking still runs for every command either
// way (see applyCommand) - this only controls the FORBIDDEN check.
function requiresD1Primary(action: CommandAction): boolean {
  return action.startsWith("items.") || action.startsWith("lists.");
}

function itemSnapshot(row: ItemRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    listId: row.list_id,
    version: row.version,
    deletedAt: row.deleted_at,
    reviewState: row.review_state,
    completedAt: row.completed_at,
  };
}

async function itemsCreate(db: Database, ownerId: string, input: ItemsCreateInput): Promise<HandlerOutcome<ReturnType<typeof itemSnapshot>>> {
  if (input.listId) {
    const list = await findListRow(db, ownerId, input.listId);
    if (!list) throw new CommandError("VALIDATION_FAILED", "listId does not refer to an existing List.");
  }
  const id = `item_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO items (owner_id, id, title, status, item_type, priority, list_id, version, review_state, created_at, created_at_source, recorded_at, updated_at, raw_json)
       VALUES (?, ?, ?, 'Not started', 'Task', NULL, ?, 1, 'needs_review', ?, 'app', ?, ?, '{}')`,
    )
    .bind(ownerId, id, input.title.trim(), input.listId ?? null, now, now, now)
    .run();
  const row = await findItemRow(db, ownerId, id);
  return {
    result: itemSnapshot(row),
    changedItemIds: [id],
    changedListIds: input.listId ? [input.listId] : [],
    activity: [{ entityId: id, eventType: "items.create", before: null, after: itemSnapshot(row) }],
  };
}

/** Runs a version-guarded UPDATE and classifies a zero-row result as NOT_FOUND vs CONFLICT vs "already in that state" via a follow-up read. Never assumes 0 rows means "nothing happened for an unknown reason." */
async function versionedItemUpdate(
  db: Database,
  ownerId: string,
  id: string,
  expectedVersion: number,
  extraWhere: string,
  setClause: string,
  bindArgs: unknown[],
): Promise<ItemRow> {
  const result = await db
    .prepare(`UPDATE items SET ${setClause}, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE owner_id = ? AND id = ? AND version = ?${extraWhere}`)
    .bind(...bindArgs, ownerId, id, expectedVersion)
    .run();
  if (result.meta.changes > 0) {
    const row = await findItemRow(db, ownerId, id);
    if (!row) throw new CommandError("INTERNAL_ERROR", "Item vanished immediately after a successful update.");
    return row;
  }
  const current = await findItemRow(db, ownerId, id);
  if (!current) throw new CommandError("NOT_FOUND", "Item not found.");
  throw new CommandError("CONFLICT", "This item changed since you last loaded it.", { currentVersion: current.version });
}

async function itemsUpdate(db: Database, ownerId: string, input: ItemsUpdateInput): Promise<HandlerOutcome<ReturnType<typeof itemSnapshot>>> {
  const before = await findItemRow(db, ownerId, input.id);
  const sets: string[] = [];
  const args: unknown[] = [];
  if ("title" in input.changes) { sets.push("title = ?"); args.push(input.changes.title); }
  if ("priority" in input.changes) { sets.push("priority = ?"); args.push(input.changes.priority ?? null); }
  if ("reviewState" in input.changes) { sets.push("review_state = ?"); args.push(input.changes.reviewState ?? null); }
  if (!sets.length) throw new CommandError("VALIDATION_FAILED", "No recognized fields in changes.");
  const row = await versionedItemUpdate(db, ownerId, input.id, input.expectedVersion, " AND deleted_at IS NULL", sets.join(", "), args);
  return {
    result: itemSnapshot(row),
    changedItemIds: [input.id],
    changedListIds: [],
    activity: [{ entityId: input.id, eventType: "items.update", before: itemSnapshot(before), after: itemSnapshot(row) }],
  };
}

async function itemsComplete(db: Database, ownerId: string, input: ItemsCompleteInput): Promise<HandlerOutcome<ReturnType<typeof itemSnapshot>>> {
  const before = await findItemRow(db, ownerId, input.id);
  const row = await versionedItemUpdate(db, ownerId, input.id, input.expectedVersion, " AND deleted_at IS NULL", "status = 'Done', completed_at = CURRENT_TIMESTAMP", []);
  return {
    result: itemSnapshot(row),
    changedItemIds: [input.id],
    changedListIds: [],
    activity: [{ entityId: input.id, eventType: "items.complete", before: itemSnapshot(before), after: itemSnapshot(row) }],
  };
}

async function itemsReopen(db: Database, ownerId: string, input: ItemsReopenInput): Promise<HandlerOutcome<ReturnType<typeof itemSnapshot>>> {
  const before = await findItemRow(db, ownerId, input.id);
  const row = await versionedItemUpdate(db, ownerId, input.id, input.expectedVersion, " AND deleted_at IS NULL", "status = 'Not started', completed_at = NULL", []);
  return {
    result: itemSnapshot(row),
    changedItemIds: [input.id],
    changedListIds: [],
    activity: [{ entityId: input.id, eventType: "items.reopen", before: itemSnapshot(before), after: itemSnapshot(row) }],
  };
}

async function itemsMove(db: Database, ownerId: string, input: ItemsMoveInput): Promise<HandlerOutcome<ReturnType<typeof itemSnapshot>>> {
  if (input.listId) {
    const list = await findListRow(db, ownerId, input.listId);
    if (!list) throw new CommandError("VALIDATION_FAILED", "listId does not refer to an existing List.");
  }
  const before = await findItemRow(db, ownerId, input.id);
  const row = await versionedItemUpdate(db, ownerId, input.id, input.expectedVersion, " AND deleted_at IS NULL", "list_id = ?", [input.listId]);
  const changedListIds = [before?.list_id, input.listId].filter((value): value is string => Boolean(value));
  return {
    result: itemSnapshot(row),
    changedItemIds: [input.id],
    changedListIds: [...new Set(changedListIds)],
    activity: [{ entityId: input.id, eventType: "items.move", before: itemSnapshot(before), after: itemSnapshot(row) }],
  };
}

async function itemsReview(db: Database, ownerId: string, input: ItemsReviewInput): Promise<HandlerOutcome<ReturnType<typeof itemSnapshot>>> {
  const before = await findItemRow(db, ownerId, input.id);
  const row = await versionedItemUpdate(db, ownerId, input.id, input.expectedVersion, " AND deleted_at IS NULL", "review_state = ?", [input.reviewState]);
  return {
    result: itemSnapshot(row),
    changedItemIds: [input.id],
    changedListIds: [],
    activity: [{ entityId: input.id, eventType: "items.review", before: itemSnapshot(before), after: itemSnapshot(row) }],
  };
}

async function itemsDelete(db: Database, ownerId: string, input: ItemsDeleteInput): Promise<HandlerOutcome<ReturnType<typeof itemSnapshot>>> {
  const before = await findItemRow(db, ownerId, input.id);
  if (before?.deleted_at) throw new CommandError("CONFLICT", "This item is already deleted.", { currentVersion: before.version });
  const row = await versionedItemUpdate(db, ownerId, input.id, input.expectedVersion, " AND deleted_at IS NULL", "deleted_at = CURRENT_TIMESTAMP", []);
  return {
    result: itemSnapshot(row),
    changedItemIds: [input.id],
    changedListIds: [],
    activity: [{ entityId: input.id, eventType: "items.delete", before: itemSnapshot(before), after: itemSnapshot(row) }],
  };
}

async function itemsRestore(db: Database, ownerId: string, input: ItemsRestoreInput): Promise<HandlerOutcome<ReturnType<typeof itemSnapshot>>> {
  const before = await findItemRow(db, ownerId, input.id);
  if (before && !before.deleted_at) throw new CommandError("CONFLICT", "This item isn't deleted.", { currentVersion: before.version });
  const row = await versionedItemUpdate(db, ownerId, input.id, input.expectedVersion, " AND deleted_at IS NOT NULL", "deleted_at = NULL", []);
  return {
    result: itemSnapshot(row),
    changedItemIds: [input.id],
    changedListIds: [],
    activity: [{ entityId: input.id, eventType: "items.restore", before: itemSnapshot(before), after: itemSnapshot(row) }],
  };
}

async function listsCreate(db: Database, ownerId: string, input: ListsCreateInput): Promise<HandlerOutcome<{ id: string; name: string }>> {
  const name = input.name.trim();
  const existing = await findListByName(db, ownerId, name);
  if (existing) throw new CommandError("VALIDATION_FAILED", "A list with that name already exists.");
  const id = `list_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const countRow = await db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS count FROM lists WHERE owner_id = ?")
    .bind(ownerId)
    .first<{ count: number }>();
  await db
    .prepare("INSERT INTO lists (owner_id, id, name, type, sort_order, created_at, updated_at) VALUES (?, ?, ?, 'general', ?, ?, ?)")
    .bind(ownerId, id, name, countRow?.count ?? 0, now, now)
    .run();
  return {
    result: { id, name },
    changedItemIds: [],
    changedListIds: [id],
    activity: [{ entityId: id, eventType: "lists.create", before: null, after: { id, name } }],
  };
}

async function listsUpdate(db: Database, ownerId: string, input: ListsUpdateInput): Promise<HandlerOutcome<{ id: string; name: string }>> {
  const before = await findListRow(db, ownerId, input.id);
  if (!before) throw new CommandError("NOT_FOUND", "List not found.");
  if (input.changes.name) {
    const trimmed = input.changes.name.trim();
    if (trimmed !== before.name) {
      const duplicate = await findListByName(db, ownerId, trimmed);
      if (duplicate) throw new CommandError("VALIDATION_FAILED", "A list with that name already exists.");
      // Rename preserves membership for free: items reference list_id, never the name string,
      // so renaming touches exactly one row (the list itself) - contrast with the legacy
      // collection-string system, which has to rewrite every member item on rename.
      await db.prepare("UPDATE lists SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE owner_id = ? AND id = ?").bind(trimmed, ownerId, input.id).run();
    }
  }
  const after = await findListRow(db, ownerId, input.id);
  return {
    result: { id: input.id, name: after!.name },
    changedItemIds: [],
    changedListIds: [input.id],
    activity: [{ entityId: input.id, eventType: "lists.update", before, after }],
  };
}

async function listsDelete(db: Database, ownerId: string, input: ListsDeleteInput): Promise<HandlerOutcome<{ deleted: true; detachedCount: number }>> {
  const before = await findListRow(db, ownerId, input.id);
  if (!before) throw new CommandError("NOT_FOUND", "List not found.");
  const members = await db.prepare("SELECT id FROM items WHERE owner_id = ? AND list_id = ?").bind(ownerId, input.id).all<{ id: string }>();
  const memberIds = members.results.map((row) => row.id);
  await db.batch([
    db.prepare("UPDATE items SET list_id = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE owner_id = ? AND list_id = ?").bind(ownerId, input.id),
    db.prepare("DELETE FROM lists WHERE owner_id = ? AND id = ?").bind(ownerId, input.id),
  ]);
  return {
    result: { deleted: true, detachedCount: memberIds.length },
    changedItemIds: memberIds,
    changedListIds: [input.id],
    activity: [{ entityId: input.id, eventType: "lists.delete", before, after: null }],
  };
}

// --- Phase 3 atomic commands (focus.*/week.*) -------------------------------------------------
//
// Astra review (Phase 3 Slice 1, c02e352, Blocker B): the non-atomic HANDLERS path below runs
// the mutation, the board-revision bump, the activity-event append, and the receipt save as four
// separate D1 round trips. Terra's fault injection proved a crash between them leaves a
// permanently inconsistent state (commitment saved, no event, no receipt; a retry then omits the
// event forever and double-bumps the revision) and that commit/withdraw can race a concurrent
// week.close. focus./week. commands instead build an AtomicPlan: one `db.batch()` call carries
// the mutation *and* its bookkeeping together, and a database-enforced guard (an `EXISTS`
// subquery baked into every statement's WHERE/SELECT clause, not a separate pre-read) makes the
// whole batch a no-op together if the precondition no longer holds by the time it runs - see
// applyAtomicPlan. items./lists. are unaffected: they stay gated behind d1_primary and unreached
// by any real owner today (see requiresD1Primary), so their pre-existing version of this same
// weakness is not this slice's concern.
type AtomicPlan = {
  /** Raw SQL boolean expression (may reference its own `?` placeholders, filled from
   * `guardParams`) that must still hold when the batch actually runs. `"1=1"` for commands with
   * no meaningful domain race condition to guard against - applyAtomicPlan ANDs this with a
   * mandatory board-revision check regardless (see expectedBoardRevision below), so this field is
   * only ever the command's own DOMAIN-specific precondition.
   *
   * Astra review (remediation round, P1#2): this MUST be the exact same precondition
   * `primaryStatement`'s own WHERE clause checks - not a subset of it. week.withdraw originally
   * guarded bookkeeping on "week open" alone while its primary UPDATE also required
   * "withdrawn_at IS NULL"; two overlapping withdrawals could then have the primary UPDATE affect
   * zero rows (already withdrawn by the other one) while the bookkeeping guard still passed,
   * producing a stored success receipt for a command that returned CONFLICT. Always mirror
   * primaryStatement's full WHERE here. */
  guardSql: string;
  guardParams: unknown[];
  /**
   * Astra review (remediation round, P1#3): captured by the handler (via getBoardState),
   * ideally as close as practical to when primaryStatement is built - not reused from an earlier
   * read elsewhere in the command pipeline. applyAtomicPlan folds `revision = expectedBoardRevision`
   * into every statement's guard (bookkeeping AND primaryStatement itself, via repository.ts's
   * revisionGuard/Stmt-builders), so `expectedBoardRevision + 1` is only ever reported/receipted
   * when the database actually reached it - never guessed under concurrent commands for the same
   * owner.
   */
  expectedBoardRevision: number;
  /** The command's own mutation; its own WHERE/SELECT clause must independently embed BOTH
   * `guardSql`'s domain condition and revisionGuard(ownerId, expectedBoardRevision) - see
   * repository.ts's Stmt-builders. Must be ordered so nothing earlier in the batch mutates a row
   * either guard reads (see week.close's finalize, which mutates the very row its domain guard
   * reads - that's why it's built to run before the revision bump but after bookkeeping). */
  primaryStatement: PreparedStatement;
  result: unknown;
  changedItemIds: string[];
  changedListIds: string[];
  activity: Array<{ entityId: string; eventType: string; before: unknown; after: unknown }>;
  /** Called only if primaryStatement affected zero rows AND the board-revision CAS held (a CAS
   * failure is always reported as CONFLICT, regardless of this field). `null` means zero rows is
   * still a legitimate success (e.g. focus.set removing an already-absent item) - never treated
   * as a failure. */
  onZeroChanges: (() => CommandError) | null;
};

type NoopOutcome = { kind: "noop"; outcome: HandlerOutcome<unknown> };
type AtomicOutcome = { kind: "atomic"; plan: AtomicPlan };

async function focusSetPlan(db: Database, ownerId: string, input: FocusSetInput): Promise<AtomicOutcome> {
  const item = await findItemRow(db, ownerId, input.itemId);
  if (!item) throw new CommandError("VALIDATION_FAILED", "itemId does not refer to an existing item.");
  const { revision: expectedBoardRevision } = await getBoardState(db, ownerId);
  const now = new Date().toISOString();
  const primaryStatement = input.focused
    ? setFocusItemStmt(db, ownerId, input.itemId, input.reviewUntil ?? null, now, expectedBoardRevision)
    : removeFocusItemStmt(db, ownerId, input.itemId, expectedBoardRevision);
  return {
    kind: "atomic",
    plan: {
      guardSql: "1=1",
      guardParams: [],
      expectedBoardRevision,
      primaryStatement,
      result: { itemId: input.itemId, focused: input.focused },
      changedItemIds: [input.itemId],
      changedListIds: [],
      activity: [{
        entityId: input.itemId,
        eventType: input.focused ? "focus.added" : "focus.removed",
        before: null,
        after: input.focused ? { reviewUntil: input.reviewUntil ?? null } : null,
      }],
      onZeroChanges: null,
    },
  };
}

async function weekCommitPlan(db: Database, ownerId: string, input: WeekCommitInput): Promise<NoopOutcome | AtomicOutcome> {
  const week = await findPlanningWeek(db, ownerId, input.weekId);
  if (!week) throw new CommandError("NOT_FOUND", "Planning week not found.");
  if (week.status === "closed") throw new CommandError("CONFLICT", "This week is closed.");
  const item = await findItemRow(db, ownerId, input.itemId);
  if (!item) throw new CommandError("VALIDATION_FAILED", "itemId does not refer to an existing item.");

  const existing = await findWeekCommitment(db, ownerId, input.weekId, input.itemId);
  if (existing && !existing.withdrawn_at) {
    // Already committed and active - idempotent no-op rather than a duplicate row/event.
    return { kind: "noop", outcome: { result: { weekId: input.weekId, itemId: input.itemId }, changedItemIds: [input.itemId], changedListIds: [], activity: [] } };
  }

  // Either a brand-new commitment or re-adding a previously withdrawn one - both go through the
  // same upsert (roadmap Phase 3 acceptance criteria requires add/withdraw/re-add).
  const { revision: expectedBoardRevision } = await getBoardState(db, ownerId);
  const now = new Date().toISOString();
  return {
    kind: "atomic",
    plan: {
      guardSql: "EXISTS (SELECT 1 FROM planning_weeks WHERE owner_id = ? AND id = ? AND status = 'open')",
      guardParams: [ownerId, input.weekId],
      expectedBoardRevision,
      primaryStatement: upsertWeekCommitmentStmt(db, ownerId, input.weekId, input.itemId, now, expectedBoardRevision),
      result: { weekId: input.weekId, itemId: input.itemId },
      changedItemIds: [input.itemId],
      changedListIds: [],
      activity: [{ entityId: input.itemId, eventType: "week.commit", before: null, after: { weekId: input.weekId } }],
      onZeroChanges: () => new CommandError("CONFLICT", "This week is closed."),
    },
  };
}

async function weekWithdrawPlan(db: Database, ownerId: string, input: WeekWithdrawInput): Promise<NoopOutcome | AtomicOutcome> {
  const week = await findPlanningWeek(db, ownerId, input.weekId);
  if (!week) throw new CommandError("NOT_FOUND", "Planning week not found.");
  if (week.status === "closed") throw new CommandError("CONFLICT", "This week is closed.");
  const existing = await findWeekCommitment(db, ownerId, input.weekId, input.itemId);
  if (!existing) throw new CommandError("NOT_FOUND", "This item is not committed to this week.");
  if (existing.withdrawn_at) {
    return { kind: "noop", outcome: { result: { weekId: input.weekId, itemId: input.itemId }, changedItemIds: [input.itemId], changedListIds: [], activity: [] } };
  }

  const { revision: expectedBoardRevision } = await getBoardState(db, ownerId);
  const now = new Date().toISOString();
  return {
    kind: "atomic",
    plan: {
      // Astra P1#2: this must mirror withdrawWeekCommitmentStmt's own full WHERE clause exactly -
      // "week open" alone isn't enough, since the primary statement ALSO requires the commitment
      // to still be active. Two overlapping withdrawals for the same item must not both pass this
      // guard - see the AtomicPlan.guardSql doc comment above.
      guardSql:
        "EXISTS (SELECT 1 FROM planning_weeks WHERE owner_id = ? AND id = ? AND status = 'open')" +
        " AND EXISTS (SELECT 1 FROM week_commitments WHERE owner_id = ? AND week_id = ? AND item_id = ? AND withdrawn_at IS NULL)",
      guardParams: [ownerId, input.weekId, ownerId, input.weekId, input.itemId],
      expectedBoardRevision,
      primaryStatement: withdrawWeekCommitmentStmt(db, ownerId, input.weekId, input.itemId, input.reason ?? null, now, expectedBoardRevision),
      result: { weekId: input.weekId, itemId: input.itemId },
      changedItemIds: [input.itemId],
      changedListIds: [],
      // Astra review (round 2 re-review): weekId must be recorded here too, just like
      // week.commit's after payload already does - the same item can be committed to multiple
      // different planning weeks independently, so weekClose needs to tell which week each
      // commit/withdraw event actually belongs to (see listActivityEventsForItems's doc comment).
      activity: [{ entityId: input.itemId, eventType: "week.withdraw", before: null, after: { weekId: input.weekId, reason: input.reason ?? null } }],
      onZeroChanges: () => new CommandError("CONFLICT", "This week is closed, or the commitment was already withdrawn by another request."),
    },
  };
}

/**
 * Astra review Blocker B: closing reads commitments/items/events, computes stats in JS, then
 * writes the frozen snapshot - a read-compute-write sequence that can't be expressed as a single
 * batch of statements. `beginClosingPlanningWeek` is the database-enforced mutual exclusion that
 * makes the middle of that sequence safe anyway: it compare-and-swaps the week from 'open' to a
 * transitional 'closing' state, and week.commit/week.withdraw's own guard (`status = 'open'`)
 * refuses to run while a week is 'closing' - so nothing can change week_commitments out from
 * under the computation. If the process crashes after entering 'closing' but before finalizing,
 * a retry (same or different request) finds status = 'closing' and simply resumes: recompute and
 * finalize, rather than erroring or leaving the week stuck.
 */
async function weekClosePlan(db: Database, ownerId: string, input: WeekCloseInput): Promise<NoopOutcome | AtomicOutcome> {
  let week = await findPlanningWeek(db, ownerId, input.weekId);
  if (!week) throw new CommandError("NOT_FOUND", "Planning week not found.");
  if (week.status === "closed") {
    // Closing an already-closed week returns the frozen snapshot verbatim - never recomputed.
    return { kind: "noop", outcome: { result: JSON.parse(week.report_json ?? "null") as WeekStats, changedItemIds: [], changedListIds: [], activity: [] } };
  }

  if (week.status !== "closing") {
    const began = await beginClosingPlanningWeek(db, ownerId, input.weekId);
    if (!began) {
      // Lost a race to another concurrent close (or the week was already 'closing') - re-read
      // and let that other request's outcome decide the answer.
      week = await findPlanningWeek(db, ownerId, input.weekId);
      if (week?.status === "closed") {
        return { kind: "noop", outcome: { result: JSON.parse(week.report_json ?? "null") as WeekStats, changedItemIds: [], changedListIds: [], activity: [] } };
      }
      throw new CommandError("CONFLICT", "This week is currently being closed by another request; retry.");
    }
  }

  // Astra review (remediation round, repository.ts:275; per-week scoping fixed in round 3, P1):
  // shared with the live GET /api/board read path (lib/server/queries.ts's computeCurrentWeekStats)
  // so weekClose's frozen snapshot and the UI's live display are always the exact same
  // computation, one implementation, not two.
  const stats = await computeCurrentWeekStats(db, ownerId, week!);

  // Astra P1#3: captured as late as practical, right before building the finalize batch, since
  // weekClose's read-compute step above can take a while - minimizing the window in which a
  // concurrent, unrelated command could bump the owner's revision and force a spurious retry here.
  const { revision: expectedBoardRevision } = await getBoardState(db, ownerId);
  return {
    kind: "atomic",
    plan: {
      guardSql: "EXISTS (SELECT 1 FROM planning_weeks WHERE owner_id = ? AND id = ? AND status = 'closing')",
      guardParams: [ownerId, input.weekId],
      expectedBoardRevision,
      primaryStatement: finalizeClosedPlanningWeekStmt(db, ownerId, input.weekId, JSON.stringify(stats), expectedBoardRevision),
      result: stats,
      changedItemIds: [],
      changedListIds: [],
      activity: [{ entityId: input.weekId, eventType: "week.close", before: null, after: stats }],
      // Should be unreachable - this request holds the exclusive 'closing' lock it just
      // confirmed - but a failure here must not be reported as success. A CONFLICT (not
      // INTERNAL_ERROR) since the far more likely cause is a concurrent unrelated command having
      // bumped the board revision during the read-compute step above; retrying is the right move.
      onZeroChanges: () => new CommandError("CONFLICT", "The board changed while closing this week; retry."),
    },
  };
}

/**
 * Executes an AtomicPlan as one `db.batch()`.
 *
 * Astra review (remediation round, P1#3): every statement - bookkeeping AND `primaryStatement`
 * itself, via repository.ts's Stmt-builders - shares the identical combined guard (`plan.guardSql`
 * AND `revision = expectedBoardRevision`). Statement order: [activity event(s), receipt,
 * primaryStatement, revision-bump]. Bookkeeping runs first so it reads every guarded table's
 * pre-image; `primaryStatement` runs next, mutating its domain table (whose pre-image every
 * earlier statement already read) while its own embedded revision check still sees board_state's
 * pre-image (the bump hasn't run yet); the revision bump runs last.
 *
 * Two independent signals come out of `results`, and they are NOT interchangeable:
 * - `guardHeld` (from the RECEIPT statement's own change count): did the whole plan's
 *   precondition - domain guard AND revision guard - hold, evaluated against the untouched
 *   pre-image? A "no" is always CONFLICT, regardless of `onZeroChanges`.
 * - `primaryChanges` (from `primaryStatement`): given the guard held, did the domain mutation
 *   itself apply, or was zero rows a legitimate no-op (e.g. focus.set removing an already-absent
 *   item)? Governed by `onZeroChanges`.
 *
 * The revision-bump statement deliberately does NOT re-check `plan.guardSql`'s domain condition
 * itself - an earlier version of this fix did, and it self-invalidated: a *successful*
 * `primaryStatement` (running immediately before it) had already mutated the very row that domain
 * condition reads, so the revision bump's own copy of that check would read back false right after
 * a legitimate success, silently skipping the bump while still returning `success` in the
 * response (caught by the P1#2 regression test in tests/focus-week-commands.test.mjs). Instead it
 * checks `EXISTS (SELECT 1 FROM command_receipts WHERE ...)` for this exact request - the receipt
 * row already evaluated the identical combined guard against the untouched pre-image, and nothing
 * in this batch mutates command_receipts afterward, so its presence is a hazard-free stand-in for
 * "the guard held" that a later statement can safely depend on.
 */
async function applyAtomicPlan(
  db: Database,
  ownerId: string,
  envelope: CommandEnvelope,
  payloadHash: string,
  plan: AtomicPlan,
): Promise<CommandResult> {
  await ensureBoardState(db, ownerId);
  const boardRevision = plan.expectedBoardRevision + 1;
  // Bound explicitly, never left to SQLite's CURRENT_TIMESTAMP default - see appendActivityEvent's
  // comment on why that default's non-ISO format silently breaks progress.ts's instant comparisons.
  const now = new Date().toISOString();

  const revision = revisionGuard(ownerId, plan.expectedBoardRevision);
  const guardSql = `(${plan.guardSql}) AND ${revision.sql}`;
  const guardParams = [...plan.guardParams, ...revision.params];

  const statements: PreparedStatement[] = [];
  for (const event of plan.activity) {
    statements.push(
      db
        .prepare(
          `INSERT INTO activity_events (id, owner_id, entity_id, actor_kind, event_type, request_id, before_json, after_json, timestamp)
           SELECT ?, ?, ?, 'owner', ?, ?, ?, ?, ? WHERE ${guardSql}`,
        )
        .bind(
          `evt_${crypto.randomUUID()}`,
          ownerId,
          event.entityId,
          event.eventType,
          envelope.requestId,
          event.before === undefined ? null : JSON.stringify(event.before),
          event.after === undefined ? null : JSON.stringify(event.after),
          now,
          ...guardParams,
        ),
    );
  }

  const success: CommandResult = {
    ok: true,
    requestId: envelope.requestId,
    boardRevision,
    result: plan.result,
    changedItemIds: plan.changedItemIds,
    changedListIds: plan.changedListIds,
  };
  const receiptIndex = statements.length;
  statements.push(
    db
      .prepare(
        `INSERT INTO command_receipts (owner_id, request_id, payload_hash, committed_revision, result_json)
         SELECT ?, ?, ?, ?, ? WHERE ${guardSql}`,
      )
      .bind(ownerId, envelope.requestId, payloadHash, boardRevision, JSON.stringify(success), ...guardParams),
  );
  const primaryIndex = statements.length;
  statements.push(plan.primaryStatement);
  // The revision bump must NOT apply when the guard failed (else the global revision counter
  // advances for a rejected command, leaving it out of step with the events/receipts actually
  // written). But it can't re-check `plan.guardSql`'s domain condition directly: that condition
  // reads a row `primaryStatement` (running immediately before this) may have just mutated, so a
  // *successful* primaryStatement would make its own domain guard read back false, incorrectly
  // failing this statement too (self-invalidation, discovered by the P1#2 regression test below).
  // The receipt row above already evaluated the exact same combined guard against the untouched
  // pre-image (nothing before it in this batch mutates anything the guard reads), and nothing
  // after it touches command_receipts either - so "did my own receipt land" is a hazard-free proxy
  // for "did the guard hold," safe to check from any later statement in the batch.
  statements.push(
    db
      .prepare(
        `UPDATE board_state SET revision = ?, updated_at = ? WHERE owner_id = ? AND revision = ?
         AND EXISTS (SELECT 1 FROM command_receipts WHERE owner_id = ? AND request_id = ?)`,
      )
      .bind(boardRevision, now, ownerId, plan.expectedBoardRevision, ownerId, envelope.requestId),
  );

  const results = await db.batch(statements);
  const guardHeld = results[receiptIndex].meta.changes > 0;
  if (!guardHeld) {
    throw new CommandError("CONFLICT", "The board changed since this command started; retry.");
  }
  const primaryChanges = results[primaryIndex].meta.changes;
  if (primaryChanges === 0 && plan.onZeroChanges) {
    throw plan.onZeroChanges();
  }
  return success;
}

const ATOMIC_HANDLERS: Partial<Record<CommandAction, (db: Database, ownerId: string, input: never) => Promise<NoopOutcome | AtomicOutcome>>> = {
  "focus.set": focusSetPlan,
  "week.commit": weekCommitPlan,
  "week.withdraw": weekWithdrawPlan,
  "week.close": weekClosePlan,
};

// Partial: focus.*/week.* are dispatched through ATOMIC_HANDLERS instead (see applyCommand).
const HANDLERS: Partial<Record<CommandAction, (db: Database, ownerId: string, input: never) => Promise<HandlerOutcome<unknown>>>> = {
  "items.create": itemsCreate,
  "items.update": itemsUpdate,
  "items.complete": itemsComplete,
  "items.reopen": itemsReopen,
  "items.move": itemsMove,
  "items.review": itemsReview,
  "items.delete": itemsDelete,
  "items.restore": itemsRestore,
  "lists.create": listsCreate,
  "lists.update": listsUpdate,
  "lists.delete": listsDelete,
};

/** Shared tail for the non-atomic items./lists. path and for focus./week.'s true no-op outcomes
 * (nothing to write, so there's no atomicity concern - see AtomicPlan/ATOMIC_HANDLERS above).
 * Runs the revision bump, activity-event append(s), and receipt save as separate statements;
 * items./lists. inherit the pre-existing (pre-Phase-3) version of Blocker B, unchanged by this
 * slice since those commands stay gated behind d1_primary and unreached by any real owner. */
async function finishViaBumpAndReceipt(
  db: Database,
  ownerId: string,
  envelope: CommandEnvelope,
  payloadHash: string,
  outcome: HandlerOutcome<unknown>,
): Promise<CommandResult> {
  const boardRevision = await bumpBoardRevision(db, ownerId);
  for (const event of outcome.activity) {
    await appendActivityEvent(db, {
      id: `evt_${crypto.randomUUID()}`,
      ownerId,
      entityId: event.entityId,
      actorKind: "owner",
      eventType: event.eventType,
      requestId: envelope.requestId,
      before: event.before,
      after: event.after,
      timestamp: new Date().toISOString(),
    });
  }

  const success: CommandResult = {
    ok: true,
    requestId: envelope.requestId,
    boardRevision,
    result: outcome.result,
    changedItemIds: outcome.changedItemIds,
    changedListIds: outcome.changedListIds,
  };
  await saveReceipt(db, ownerId, envelope.requestId, payloadHash, boardRevision, JSON.stringify(success));
  return success;
}

/**
 * The single mutation entry point for d1_primary owners. Validates the envelope, enforces
 * idempotency via command_receipts, dispatches to the matching handler, records an activity
 * event per affected entity, bumps the board revision, and persists a receipt - all before
 * returning. Never touches Notion; never runs for a legacy_notion owner (see requireD1Primary).
 */
export async function applyCommand(db: Database, ownerId: string, envelope: CommandEnvelope): Promise<CommandResult> {
  try {
    if (!isKnownCommand(envelope.action)) {
      throw new CommandError("VALIDATION_FAILED", `Unknown action: ${envelope.action}`);
    }
    const boardRevisionBefore = requiresD1Primary(envelope.action)
      ? await requireD1Primary(db, ownerId)
      : (await getBoardState(db, ownerId)).revision;
    if (envelope.expectedBoardRevision !== undefined && envelope.expectedBoardRevision !== boardRevisionBefore) {
      throw new CommandError("CONFLICT", "The board changed since you last loaded it.", { currentBoardRevision: boardRevisionBefore });
    }

    const payloadHash = hashPayload(envelope.payload);
    const existingReceipt = await getReceipt(db, ownerId, envelope.requestId);
    if (existingReceipt) {
      if (existingReceipt.payloadHash !== payloadHash) {
        throw new CommandError("CONFLICT", "This request ID was already used with different content.");
      }
      return JSON.parse(existingReceipt.resultJson) as CommandResult;
    }

    const schema = COMMAND_SCHEMAS[envelope.action];
    const parsed = schema.safeParse(envelope.payload);
    if (!parsed.success) {
      throw new CommandError("VALIDATION_FAILED", "Invalid command payload.", parsed.error.flatten());
    }

    const atomicHandler = ATOMIC_HANDLERS[envelope.action];
    if (atomicHandler) {
      const outcome = await atomicHandler(db, ownerId, parsed.data as never);
      if (outcome.kind === "atomic") {
        return await applyAtomicPlan(db, ownerId, envelope, payloadHash, outcome.plan);
      }
      return await finishViaBumpAndReceipt(db, ownerId, envelope, payloadHash, outcome.outcome);
    }

    const handler = HANDLERS[envelope.action]!;
    const outcome = await handler(db, ownerId, parsed.data as never);
    return await finishViaBumpAndReceipt(db, ownerId, envelope, payloadHash, outcome);
  } catch (error) {
    if (error instanceof CommandError) {
      return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
    }
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { ok: false, error: { code: "INTERNAL_ERROR", message } };
  }
}
