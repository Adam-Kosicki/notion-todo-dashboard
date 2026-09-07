// Phase 1 (docs/plans/burner-board-roadmap.md, section 7): the single mutation entry point
// for the new d1_primary storage mode. Enforces preconditions, idempotency, audit events, and
// atomic persistence per command.
//
// Scope decision for this phase (routine engineering choice, not escalated): this module is
// NOT wired into app/api/board/route.ts yet. It's fully built and tested in isolation against
// the synthetic D1 harness (tests/commands.test.mjs), reachable once a later phase actually
// flips an owner's storage_mode to "d1_primary" and routes requests through it. The real owner
// stays on the existing legacy_notion path (board-store.ts, unchanged) until the phase 4
// cutover gate. This keeps Phase 1 zero-risk to the live app while still proving the new layer
// works end to end.
//
// D1-primary invariant: this file has no Notion import and makes no network call anywhere in
// it. That's not a runtime check - it's true by construction, which is the simplest possible
// guarantee that "d1_primary mode never invokes Notion."
import {
  COMMAND_SCHEMAS,
  CommandError,
  ERROR_STATUS,
  type CommandAction,
  type CommandEnvelope,
  type CommandResult,
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
  isKnownCommand,
} from "@/lib/domain/contracts";
import {
  appendActivityEvent,
  bumpBoardRevision,
  findItemRow,
  findListByName,
  findListRow,
  getBoardState,
  getReceipt,
  saveReceipt,
  type Database,
  type ItemRow,
} from "@/lib/server/repository";

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

const HANDLERS: Record<CommandAction, (db: Database, ownerId: string, input: never) => Promise<HandlerOutcome<unknown>>> = {
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
    const boardRevisionBefore = await requireD1Primary(db, ownerId);
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

    const handler = HANDLERS[envelope.action];
    const outcome = await handler(db, ownerId, parsed.data as never);

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
  } catch (error) {
    if (error instanceof CommandError) {
      return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
    }
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { ok: false, error: { code: "INTERNAL_ERROR", message } };
  }
}
