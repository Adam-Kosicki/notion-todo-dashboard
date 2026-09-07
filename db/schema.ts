import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const items = sqliteTable(
  "items",
  {
    ownerId: text("owner_id").notNull(),
    id: text("id").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("Not started"),
    burner: text("burner"),
    priority: real("priority"),
    priorityLevel: text("priority_level"),
    itemType: text("item_type").notNull().default("Task"),
    source: text("source"),
    collection: text("collection"),
    due: text("due"),
    scheduledFor: text("scheduled_for"),
    dateMode: text("date_mode"),
    recurrence: text("recurrence"),
    reminderTime: text("reminder_time"),
    energy: text("energy"),
    context: text("context"),
    area: text("area"),
    project: text("project"),
    goal: text("goal"),
    originalNotes: text("original_notes"),
    tags: text("tags"),
    groupId: text("group_id"),
    lastInteraction: text("last_interaction"),
    lastNudge: text("last_nudge"),
    completedAt: text("completed_at"),
    attentionScore: real("attention_score").notNull().default(0),
    stalenessDays: real("staleness_days").notNull().default(0),
    starred: integer("starred", { mode: "boolean" }).notNull().default(false),
    dirty: integer("dirty", { mode: "boolean" }).notNull().default(false),
    rawJson: text("raw_json").notNull().default("{}"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    // Phase 1 (docs/plans/burner-board-roadmap.md): stable membership by id rather than by
    // list name string. `collection` stays as the compatibility/source text field — nothing
    // reads listId yet outside the new d1_primary command path (lib/server/commands.ts).
    listId: text("list_id"),
    // Original creation time, when trustworthy source metadata exists (e.g. Notion's native
    // "Created time"). Distinct from updatedAt (changes on every edit) and recordedAt (below).
    createdAt: text("created_at"),
    createdAtSource: text("created_at_source"),
    // When this app first recorded the row locally - always known for new rows (every insert
    // sets it explicitly; see lib/server/commands.ts's itemsCreate), backfilled for legacy rows
    // by migration 0008's data UPDATE. No DB-level default: SQLite's ALTER TABLE ADD COLUMN
    // rejects a non-constant default (CURRENT_TIMESTAMP) on a table that already has rows -
    // see tests/migrations.test.mjs's "non-empty table" test and drizzle/0008's comment.
    recordedAt: text("recorded_at"),
    // Tombstone for the new d1_primary delete path (replaces hard DELETE - see deleteItem's
    // legacy_notion behavior in board-store.ts, unchanged for now).
    deletedAt: text("deleted_at"),
    reviewState: text("review_state"),
    // Optimistic-concurrency counter for the new command layer. Legacy_notion writes (the
    // existing updateItem/deleteItem etc.) do not increment this yet.
    version: integer("version").notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    index("idx_items_owner_status_burner").on(table.ownerId, table.status, table.burner),
    index("idx_items_owner_priority").on(table.ownerId, table.priority),
    index("idx_items_owner_collection").on(table.ownerId, table.collection),
    index("idx_items_owner_type_status").on(table.ownerId, table.itemType, table.status),
    index("idx_items_owner_completed").on(table.ownerId, table.completedAt),
    index("idx_items_owner_group").on(table.ownerId, table.groupId),
    index("idx_items_owner_list_id").on(table.ownerId, table.listId),
    index("idx_items_owner_deleted").on(table.ownerId, table.deletedAt),
  ],
);

export const lists = sqliteTable(
  "lists",
  {
    ownerId: text("owner_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull().default("general"),
    showPriority: integer("show_priority", { mode: "boolean" }),
    showLongTermGoals: integer("show_long_term_goals", { mode: "boolean" }),
    reminderDefault: text("reminder_default"),
    defaultItemType: text("default_item_type"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    index("idx_lists_owner_name").on(table.ownerId, table.name),
  ],
);

export const integrations = sqliteTable(
  "integrations",
  {
    ownerId: text("owner_id").notNull(),
    provider: text("provider").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    connectedAt: text("connected_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.provider] })],
);

export const appMeta = sqliteTable(
  "app_meta",
  {
    ownerId: text("owner_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.key] })],
);

// Phase 1 (docs/plans/burner-board-roadmap.md): owner-level revision counter and the
// legacy_notion -> d1_primary storage-mode switch. Stays "legacy_notion" for every real owner
// until the phase 4 cutover gate is satisfied - see docs/operations/data-recovery.md.
export const boardState = sqliteTable(
  "board_state",
  {
    ownerId: text("owner_id").notNull(),
    revision: integer("revision").notNull().default(0),
    storageMode: text("storage_mode").notNull().default("legacy_notion"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.ownerId] })],
);

// One row per accepted command request. A replayed request_id with the SAME payload returns
// the stored result (idempotent, no duplicate activity_events); a different payload is a
// CONFLICT (see lib/server/commands.ts).
export const commandReceipts = sqliteTable(
  "command_receipts",
  {
    ownerId: text("owner_id").notNull(),
    requestId: text("request_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    committedRevision: integer("committed_revision").notNull(),
    resultJson: text("result_json").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.requestId] })],
);

// Append-only. Not a general event-sourcing log (current-state tables remain authoritative) -
// this exists for progress/history evidence and targeted undo, per the roadmap's explicit
// "do not add a general event-sourcing framework" instruction.
export const activityEvents = sqliteTable(
  "activity_events",
  {
    id: text("id").notNull(),
    ownerId: text("owner_id").notNull(),
    entityId: text("entity_id").notNull(),
    actorKind: text("actor_kind").notNull(),
    eventType: text("event_type").notNull(),
    timestamp: text("timestamp").notNull().default(sql`CURRENT_TIMESTAMP`),
    requestId: text("request_id"),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("idx_activity_owner_entity").on(table.ownerId, table.entityId),
    index("idx_activity_owner_timestamp").on(table.ownerId, table.timestamp),
  ],
);

// Phase 3 (docs/plans/burner-board-roadmap.md): Focus is a user-selected current-priority set,
// independent of List membership, importance, and Last Interaction. Like Groups (see
// PRODUCT_SPEC.md's "Groups" section), it has no Notion equivalent and never round-trips there -
// unlike items/lists, it is NOT gated behind d1_primary storage mode (see commands.ts's
// requiresD1Primary), so it's usable by the real owner today, not only after the phase 4
// cutover.
export const focusItems = sqliteTable(
  "focus_items",
  {
    ownerId: text("owner_id").notNull(),
    itemId: text("item_id").notNull(),
    selectedAt: text("selected_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    reviewUntil: text("review_until"),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.itemId] })],
);

// A Monday-start planning week (start_date is a calendar date, YYYY-MM-DD, in the owner's
// timezone - see lib/domain/progress.ts's mondayStartOf). `reportJson` stays null while status
// is "open" (stats are computed live from week_commitments); week.close fills it in exactly
// once, and after that the stored snapshot is authoritative - per the roadmap's "closing a week
// freezes its report; later edits do not rewrite historical reports."
export const planningWeeks = sqliteTable(
  "planning_weeks",
  {
    ownerId: text("owner_id").notNull(),
    id: text("id").notNull(),
    startDate: text("start_date").notNull(),
    timezone: text("timezone").notNull(),
    status: text("status").notNull().default("open"),
    reportJson: text("report_json"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    uniqueIndex("idx_planning_weeks_owner_start_unique").on(table.ownerId, table.startDate),
  ],
);

// One row per item committed to a planning week. withdrawn_at/withdrawal_reason are set in
// place rather than deleting the row - the weekly statistics contract's denominator is "all
// commitments added to the week, including withdrawals," so a withdrawn commitment must remain
// visible to that computation, not disappear.
export const weekCommitments = sqliteTable(
  "week_commitments",
  {
    ownerId: text("owner_id").notNull(),
    weekId: text("week_id").notNull(),
    itemId: text("item_id").notNull(),
    addedAt: text("added_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    withdrawnAt: text("withdrawn_at"),
    withdrawalReason: text("withdrawal_reason"),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.weekId, table.itemId] }),
    index("idx_week_commitments_owner_week").on(table.ownerId, table.weekId),
  ],
);
