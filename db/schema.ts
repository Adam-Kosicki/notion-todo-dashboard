import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    lastInteraction: text("last_interaction"),
    lastNudge: text("last_nudge"),
    completedAt: text("completed_at"),
    attentionScore: real("attention_score").notNull().default(0),
    stalenessDays: real("staleness_days").notNull().default(0),
    starred: integer("starred", { mode: "boolean" }).notNull().default(false),
    todoistId: text("todoist_id"),
    showInTodoist: integer("show_in_todoist", { mode: "boolean" }).notNull().default(false),
    dirty: integer("dirty", { mode: "boolean" }).notNull().default(false),
    rawJson: text("raw_json").notNull().default("{}"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    index("idx_items_owner_status_burner").on(table.ownerId, table.status, table.burner),
    index("idx_items_owner_priority").on(table.ownerId, table.priority),
    index("idx_items_owner_collection").on(table.ownerId, table.collection),
    index("idx_items_owner_type_status").on(table.ownerId, table.itemType, table.status),
    index("idx_items_owner_completed").on(table.ownerId, table.completedAt),
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
