/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";

import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import type { BoardItem, BoardList, BoardPayload, EditableChanges, EditableList, RelationOption } from "@/lib/board-types";

const NOTION_VERSION = "2026-03-11";

const COLUMN_MAP: Record<string, string> = {
  title: "title",
  status: "status",
  itemType: "item_type",
  burner: "burner",
  priority: "priority",
  priorityLevel: "priority_level",
  collection: "collection",
  due: "due",
  scheduledFor: "scheduled_for",
  dateMode: "date_mode",
  recurrence: "recurrence",
  reminderTime: "reminder_time",
  energy: "energy",
  context: "context",
  area: "area",
  project: "project",
  goal: "goal",
  originalNotes: "original_notes",
  tags: "tags",
  lastInteraction: "last_interaction",
  completedAt: "completed_at",
  starred: "starred",
  showInTodoist: "show_in_todoist",
};

type RuntimeEnv = {
  DB: any;
  APP_SECRET?: string;
  NOTION_ITEMS_DATA_SOURCE_ID?: string;
  NOTION_AREAS_DATA_SOURCE_ID?: string;
  NOTION_PROJECTS_DATA_SOURCE_ID?: string;
  NOTION_GOALS_DATA_SOURCE_ID?: string;
};
type StoredItem = Record<string, unknown> & { id: string; title: string };
type StoredIntegration = { ciphertext: string; iv: string };

function runtime(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

function notionDataSources() {
  const runtimeEnv = runtime();
  const items = runtimeEnv.NOTION_ITEMS_DATA_SOURCE_ID?.trim();
  if (!items) throw new Error("NOTION_ITEMS_DATA_SOURCE_ID_MISSING");
  return {
    items,
    areas: runtimeEnv.NOTION_AREAS_DATA_SOURCE_ID?.trim() || null,
    projects: runtimeEnv.NOTION_PROJECTS_DATA_SOURCE_ID?.trim() || null,
    goals: runtimeEnv.NOTION_GOALS_DATA_SOURCE_ID?.trim() || null,
  };
}

export async function requireOwnerId() {
  const requestHeaders = await headers();
  const oaiId = requestHeaders.get("oai-authenticated-user-id");
  if (oaiId) return oaiId;
  // Cloudflare Access strips any client-supplied Cf-Access-* header at the edge and
  // only sets this one itself after a successful login to an Access-protected
  // hostname, so it's safe to trust directly at the origin without JWT verification.
  const accessEmail = requestHeaders.get("cf-access-authenticated-user-email");
  if (accessEmail) return accessEmail.toLowerCase();
  throw new Error("AUTH_REQUIRED");
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toBase64(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function appKey() {
  const secret = runtime().APP_SECRET;
  if (!secret) throw new Error("APP_SECRET_MISSING");
  return crypto.subtle.importKey("raw", fromBase64(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await appKey(), new TextEncoder().encode(token)),
  );
  return { ciphertext: toBase64(ciphertext), iv: toBase64(iv) };
}

async function decryptToken(stored: StoredIntegration) {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(stored.iv) },
    await appKey(),
    fromBase64(stored.ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}

function bool(value: unknown) {
  return value === true || value === 1 || value === "1";
}

function nullable(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

const ITEM_COLUMNS = [
  "owner_id", "id", "title", "status", "burner", "priority", "priority_level", "item_type",
  "source", "collection", "due", "scheduled_for", "date_mode", "recurrence", "reminder_time", "energy", "context", "area", "project", "goal", "original_notes", "tags",
  "last_interaction", "last_nudge", "completed_at", "attention_score", "staleness_days", "starred", "todoist_id",
  "show_in_todoist", "dirty", "raw_json",
];

function itemValues(ownerId: string, item: StoredItem) {
  return [
    ownerId,
    item.id,
    item.title,
    item.status || "Not started",
    nullable(item.burner),
    nullable(item.priority),
    nullable(item.priorityLevel),
    item.itemType || "Task",
    nullable(item.source),
    nullable(item.collection || item.legacyList),
    nullable(item.due),
    nullable(item.scheduledFor),
    nullable(item.dateMode || (item.due ? "date_set" : null)),
    nullable(item.recurrence),
    nullable(item.reminderTime),
    nullable(item.energy),
    nullable(item.context),
    nullable(item.area),
    nullable(item.project),
    nullable(item.goal),
    nullable(item.originalNotes),
    nullable(item.tags),
    nullable(item.lastInteraction),
    nullable(item.lastNudge),
    nullable(item.completedAt),
    Number(item.attentionScore || 0),
    Number(item.stalenessDays || 0),
    bool(item.starred) ? 1 : 0,
    nullable(item.todoistId),
    bool(item.showInTodoist) ? 1 : 0,
    0,
    JSON.stringify(item),
  ];
}

export async function ensureSeed(ownerId: string) {
  const db = runtime().DB;
  const marker = await db
    .prepare("SELECT value FROM app_meta WHERE owner_id = ? AND key = ?")
    .bind(ownerId, "seed_v1")
    .first();
  if (marker) return;

  await db.prepare("INSERT OR REPLACE INTO app_meta (owner_id, key, value) VALUES (?, ?, ?)")
    .bind(ownerId, "seed_v1", "empty")
    .run();
}

function normalizedPriority(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(10, Math.round(number)));
}

function burnerForPriority(priority: number | null) {
  if (priority === null || priority === 0) return null;
  if (priority >= 8) return "Front Burner";
  if (priority >= 4) return "Simmering";
  return "Back Burner";
}

function importedPriority(input: {
  priority: unknown;
  burner: string | null;
  itemType: string;
  collection: string | null;
}) {
  const rawNumber = input.priority === null || input.priority === undefined || input.priority === ""
    ? null
    : Number(input.priority);
  if (rawNumber !== null && Number.isFinite(rawNumber) && rawNumber >= 0 && rawNumber <= 10) {
    return Math.round(rawNumber);
  }
  if (input.burner === "Front Burner") return 9;
  if (input.burner === "Simmering") return 6;
  if (input.burner === "Back Burner") return 3;
  if (input.burner === "Someday") return 0;
  if (rawNumber !== null && Number.isFinite(rawNumber)) return normalizedPriority(rawNumber);
  if (["Grocery", "Wish List", "Bucket List", "Monthly Payments", "Warranties"].includes(input.collection || "")) return 0;
  if (["Goal", "Someday", "Reference"].includes(input.itemType)) return 0;
  return null;
}

function recurrenceFromNotes(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/\brepeats?\s+(daily|weekdays?|weekly|monthly|yearly)\b/i);
  if (!match) return null;
  const label = match[1].toLowerCase();
  if (label.startsWith("weekday")) return "Weekdays";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export async function ensureOrganization(ownerId: string) {
  const db = runtime().DB;
  const marker = await db
    .prepare("SELECT value FROM app_meta WHERE owner_id = ? AND key = ?")
    .bind(ownerId, "organization_v4")
    .first();
  if (marker) return;

  const result = await db.prepare(
    "SELECT id, priority, burner, item_type, source, collection, due, date_mode, recurrence, original_notes, completed_at, status, raw_json FROM items WHERE owner_id = ?",
  ).bind(ownerId).all();
  const statements = (result.results || []).map((row: any) => {
    let raw: Record<string, unknown> = {};
    try { raw = JSON.parse(row.raw_json || "{}"); } catch { raw = {}; }
    const legacyList = typeof raw.legacyList === "string" ? raw.legacyList.trim() : "";
    const existingCollection = row.collection === "Google Tasks / Unsorted" ? null : row.collection;
    const collection = legacyList || existingCollection || null;
    const recurrence = row.recurrence || recurrenceFromNotes(row.original_notes || raw.originalNotes);
    const itemType = recurrence ? "Reminder" : row.item_type || "Task";
    const priority = importedPriority({
      priority: row.priority,
      burner: row.burner,
      itemType,
      collection,
    });
    const completedAt = row.completed_at || raw.completedAt || null;
    const dateMode = row.date_mode || (row.due ? "date_set" : priority === 0 ? "no_date" : null);
    return db.prepare(
      "UPDATE items SET collection = ?, priority = ?, burner = ?, item_type = ?, recurrence = ?, date_mode = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE owner_id = ? AND id = ?",
    ).bind(collection, priority, burnerForPriority(priority), itemType, recurrence, dateMode, completedAt, ownerId, row.id);
  });
  for (let index = 0; index < statements.length; index += 40) {
    await db.batch(statements.slice(index, index + 40));
  }
  await db.prepare("INSERT OR REPLACE INTO app_meta (owner_id, key, value) VALUES (?, ?, ?)")
    .bind(ownerId, "organization_v4", "reminders+completion-history+date-expectations")
    .run();
}

function rowToItem(row: any): BoardItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    burner: row.burner,
    priority: row.priority,
    priorityLevel: row.priority_level,
    itemType: row.item_type,
    source: row.source,
    collection: row.collection,
    due: row.due,
    scheduledFor: row.scheduled_for,
    dateMode: row.date_mode,
    recurrence: row.recurrence,
    reminderTime: row.reminder_time,
    energy: row.energy,
    context: row.context,
    area: row.area,
    project: row.project,
    goal: row.goal,
    originalNotes: row.original_notes,
    tags: row.tags,
    lastInteraction: row.last_interaction,
    lastNudge: row.last_nudge,
    completedAt: row.completed_at,
    attentionScore: Number(row.attention_score || 0),
    stalenessDays: Number(row.staleness_days || 0),
    starred: bool(row.starred),
    todoistId: row.todoist_id,
    showInTodoist: bool(row.show_in_todoist),
    dirty: bool(row.dirty),
    updatedAt: row.updated_at,
  };
}

function rowToList(row: any): BoardList {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    showPriority: row.show_priority === null || row.show_priority === undefined ? null : Boolean(row.show_priority),
    showLongTermGoals: row.show_long_term_goals === null || row.show_long_term_goals === undefined ? null : Boolean(row.show_long_term_goals),
    reminderDefault: row.reminder_default,
    sortOrder: Number(row.sort_order || 0),
  };
}

const LIST_TYPE_HINTS: Record<string, string> = {
  Grocery: "shopping",
  "Wish List": "reference",
  "Bucket List": "reference",
  "Monthly Payments": "recurring_payment",
  Warranties: "reference",
  Goals: "goal",
};

function inferListType(name: string) {
  return LIST_TYPE_HINTS[name] || "general";
}

export async function ensureListsBackfill(ownerId: string) {
  const db = runtime().DB;
  const marker = await db
    .prepare("SELECT value FROM app_meta WHERE owner_id = ? AND key = ?")
    .bind(ownerId, "lists_v1")
    .first();
  if (marker) return;

  const existing = await db.prepare("SELECT name FROM lists WHERE owner_id = ?").bind(ownerId).all();
  const existingNames = new Set((existing.results || []).map((row: any) => row.name));
  const collections = await db
    .prepare("SELECT DISTINCT collection FROM items WHERE owner_id = ? AND collection IS NOT NULL")
    .bind(ownerId)
    .all();
  const names = (collections.results || [])
    .map((row: any) => row.collection as string)
    .filter((name: string) => name && !existingNames.has(name));
  const now = new Date().toISOString();
  const statements = names.map((name: string, index: number) =>
    db.prepare(
      "INSERT INTO lists (owner_id, id, name, type, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(ownerId, `list_${crypto.randomUUID()}`, name, inferListType(name), index, now, now),
  );
  for (let index = 0; index < statements.length; index += 40) {
    await db.batch(statements.slice(index, index + 40));
  }
  await db.prepare("INSERT OR REPLACE INTO app_meta (owner_id, key, value) VALUES (?, ?, ?)")
    .bind(ownerId, "lists_v1", "backfilled")
    .run();
}

export async function listLists(ownerId: string): Promise<BoardList[]> {
  const db = runtime().DB;
  const result = await db
    .prepare("SELECT * FROM lists WHERE owner_id = ? ORDER BY sort_order, name COLLATE NOCASE")
    .bind(ownerId)
    .all();
  return (result.results || []).map(rowToList);
}

async function findList(ownerId: string, id: string) {
  const row = await runtime().DB.prepare("SELECT * FROM lists WHERE owner_id = ? AND id = ?").bind(ownerId, id).first();
  if (!row) throw new Error("List not found.");
  return row as Record<string, unknown> & { name: string };
}

export async function createList(ownerId: string, input: { name: string; type?: string }) {
  const name = input.name.trim();
  if (!name) throw new Error("Give the list a name first.");
  const db = runtime().DB;
  const existing = await db.prepare("SELECT id FROM lists WHERE owner_id = ? AND name = ?").bind(ownerId, name).first();
  if (existing) throw new Error("A list with that name already exists.");
  const id = `list_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const countRow = await db.prepare("SELECT COUNT(*) as count FROM lists WHERE owner_id = ?").bind(ownerId).first() as { count: number } | null;
  await db.prepare(
    "INSERT INTO lists (owner_id, id, name, type, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(ownerId, id, name, input.type || "general", countRow?.count || 0, now, now).run();
  return rowToList(await db.prepare("SELECT * FROM lists WHERE owner_id = ? AND id = ?").bind(ownerId, id).first());
}

export async function updateList(ownerId: string, id: string, changes: EditableList) {
  const db = runtime().DB;
  const current = await findList(ownerId, id);
  const sets: string[] = [];
  const values: unknown[] = [];

  if (changes.name) {
    const trimmed = changes.name.trim();
    if (trimmed && trimmed !== current.name) {
      // Items only reference a list by its name string, so a rename has to carry every item along.
      // Notion's "Legacy List" select stays out of sync here (like any other bulk edit) until each
      // item is touched again — there is no bulk-push path today, only per-item updateItem() syncs.
      await db.prepare("UPDATE items SET collection = ?, dirty = 1 WHERE owner_id = ? AND collection = ?")
        .bind(trimmed, ownerId, current.name).run();
      sets.push("name = ?");
      values.push(trimmed);
    }
  }
  if ("type" in changes) { sets.push("type = ?"); values.push(changes.type); }
  if ("showPriority" in changes) { sets.push("show_priority = ?"); values.push(changes.showPriority === null || changes.showPriority === undefined ? null : changes.showPriority ? 1 : 0); }
  if ("showLongTermGoals" in changes) { sets.push("show_long_term_goals = ?"); values.push(changes.showLongTermGoals === null || changes.showLongTermGoals === undefined ? null : changes.showLongTermGoals ? 1 : 0); }
  if ("reminderDefault" in changes) { sets.push("reminder_default = ?"); values.push(nullable(changes.reminderDefault)); }

  if (sets.length) {
    sets.push("updated_at = CURRENT_TIMESTAMP");
    await db.prepare(`UPDATE lists SET ${sets.join(", ")} WHERE owner_id = ? AND id = ?`).bind(...values, ownerId, id).run();
  }
  return rowToList(await db.prepare("SELECT * FROM lists WHERE owner_id = ? AND id = ?").bind(ownerId, id).first());
}

export async function deleteList(ownerId: string, id: string) {
  const db = runtime().DB;
  const current = await findList(ownerId, id);
  const countRow = await db.prepare("SELECT COUNT(*) as count FROM items WHERE owner_id = ? AND collection = ?")
    .bind(ownerId, current.name).first() as { count: number } | null;
  const reassignedCount = countRow?.count || 0;
  if (reassignedCount > 0) {
    await db.prepare("UPDATE items SET collection = NULL, dirty = 1 WHERE owner_id = ? AND collection = ?")
      .bind(ownerId, current.name).run();
  }
  await db.prepare("DELETE FROM lists WHERE owner_id = ? AND id = ?").bind(ownerId, id).run();
  return { deleted: true, reassignedCount };
}

function relationOption(value: string | null): RelationOption | null {
  if (!value) return null;
  const url = value.match(/https?:\/\/[^)]+/)?.[0] || "";
  const id = url.match(/([0-9a-f]{32})(?:\?|$)/i)?.[1] || value;
  const label = value.replace(/\s*\(https?:\/\/[^)]+\)\s*$/, "").trim();
  return { id, label, value };
}

function collectRelations(items: BoardItem[], key: "area" | "project" | "goal") {
  const map = new Map<string, RelationOption>();
  for (const item of items) {
    const raw = item[key];
    if (!raw) continue;
    for (const part of raw.split(/,\s+(?=[^,]+\(https?:\/\/)/)) {
      const option = relationOption(part);
      if (option) map.set(option.id, option);
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export async function getBoard(ownerId: string): Promise<BoardPayload> {
  await ensureSeed(ownerId);
  await ensureOrganization(ownerId);
  await ensureListsBackfill(ownerId);
  const db = runtime().DB;
  const result = await db.prepare(
    "SELECT * FROM items WHERE owner_id = ? ORDER BY CASE status WHEN 'In progress' THEN 0 WHEN 'Not started' THEN 1 ELSE 2 END, COALESCE(priority, -1) DESC, attention_score DESC, title COLLATE NOCASE",
  ).bind(ownerId).all();
  let items = (result.results || []).map(rowToItem);
  const connections = await db.prepare("SELECT provider FROM integrations WHERE owner_id = ?").bind(ownerId).all();
  const providers = new Set((connections.results || []).map((row: any) => row.provider));
  const todayQueue = items.filter((item) => belongsInToday(item) && !item.showInTodoist);
  if (todayQueue.length) {
    await db.batch(todayQueue.map((item) => db.prepare(
      "UPDATE items SET show_in_todoist = 1, dirty = 1 WHERE owner_id = ? AND id = ?",
    ).bind(ownerId, item.id)));
  }
  if (providers.has("todoist")) await syncTodoistQueue(ownerId);
  if (todayQueue.length || providers.has("todoist")) {
    const refreshed = await db.prepare(
      "SELECT * FROM items WHERE owner_id = ? ORDER BY CASE status WHEN 'In progress' THEN 0 WHEN 'Not started' THEN 1 ELSE 2 END, COALESCE(priority, -1) DESC, attention_score DESC, title COLLATE NOCASE",
    ).bind(ownerId).all();
    items = (refreshed.results || []).map(rowToItem);
  }
  return {
    items,
    connections: { notion: providers.has("notion"), todoist: providers.has("todoist") },
    relations: {
      areas: collectRelations(items, "area"),
      projects: collectRelations(items, "project"),
      goals: collectRelations(items, "goal"),
    },
    collections: [...new Set(items.map((item) => item.collection).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)),
    lists: await listLists(ownerId),
    importedCount: items.length,
  };
}

async function getIntegration(ownerId: string, provider: "notion" | "todoist") {
  const row = await runtime().DB.prepare(
    "SELECT ciphertext, iv FROM integrations WHERE owner_id = ? AND provider = ?",
  ).bind(ownerId, provider).first() as StoredIntegration | null;
  return row ? decryptToken(row) : null;
}

async function notionRequest(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(payload.message || `Notion returned ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

async function todoistRequest(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.todoist.com/api/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(payload.message || payload.error || `Todoist returned ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

export async function connectProvider(ownerId: string, provider: "notion" | "todoist", token: string) {
  const cleanToken = token.trim();
  if (!cleanToken) throw new Error("Paste a token first.");
  if (provider === "notion") {
    await notionRequest(cleanToken, `/data_sources/${notionDataSources().items}`);
  } else {
    await todoistRequest(cleanToken, "/tasks?limit=1");
  }
  const encrypted = await encryptToken(cleanToken);
  await runtime().DB.prepare(
    "INSERT INTO integrations (owner_id, provider, ciphertext, iv) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, provider) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, connected_at = CURRENT_TIMESTAMP",
  ).bind(ownerId, provider, encrypted.ciphertext, encrypted.iv).run();
  if (provider === "todoist") await syncTodoistQueue(ownerId);
  return { provider, connected: true };
}

export async function disconnectProvider(ownerId: string, provider: "notion" | "todoist") {
  await runtime().DB.prepare("DELETE FROM integrations WHERE owner_id = ? AND provider = ?").bind(ownerId, provider).run();
  return { provider, connected: false };
}

function richText(value: string | null | undefined) {
  if (!value) return [];
  return value.match(/[\s\S]{1,1900}/g)?.map((content) => ({ type: "text", text: { content } })) || [];
}

function relationId(value: string | null | undefined) {
  if (!value) return null;
  return value.match(/([0-9a-f]{32})(?:\?|\)|$)/i)?.[1] || value.match(/[0-9a-f-]{36}/i)?.[0] || null;
}

function dateValue(value: string | null | undefined) {
  if (!value) return null;
  const iso = value.match(/^\d{4}-\d{2}-\d{2}(?:T[^ ]+)?/)?.[0];
  return iso ? { start: iso } : null;
}

const REMINDER_BLOCK = /\n?\[Burner Board reminder\][\s\S]*?\[\/Burner Board reminder\]\n?/i;

function parseReminderNotes(value: string | null) {
  const block = value?.match(REMINDER_BLOCK)?.[0] || "";
  const field = (name: string) => block.match(new RegExp(`^${name}:\\s*(.+)$`, "im"))?.[1]?.trim() || null;
  return {
    notes: (value || "").replace(REMINDER_BLOCK, "").trim() || null,
    dateMode: field("Date rule"),
    recurrence: field("Repeat") || recurrenceFromNotes(value),
    reminderTime: field("Time"),
  };
}

function notesWithReminderMetadata(item: BoardItem) {
  const notes = (item.originalNotes || "").replace(REMINDER_BLOCK, "").trim();
  if (!item.dateMode && !item.recurrence && !item.reminderTime) return notes || null;
  const metadata = [
    "[Burner Board reminder]",
    item.dateMode ? `Date rule: ${item.dateMode}` : null,
    item.recurrence ? `Repeat: ${item.recurrence}` : null,
    item.reminderTime ? `Time: ${item.reminderTime}` : null,
    "[/Burner Board reminder]",
  ].filter(Boolean).join("\n");
  return [notes, metadata].filter(Boolean).join("\n\n");
}

function notionProperties(changes: EditableChanges) {
  const properties: Record<string, unknown> = {};
  if ("title" in changes) properties["Task name"] = { title: richText(changes.title) };
  if ("status" in changes) properties.Status = { status: changes.status ? { name: changes.status } : null };
  if ("itemType" in changes) properties["Item Type"] = { select: changes.itemType ? { name: changes.itemType } : null };
  if ("burner" in changes) properties.Burner = { select: changes.burner && changes.burner !== "Unsorted" ? { name: changes.burner } : null };
  if ("priority" in changes) properties.Priority = { number: changes.priority ?? null };
  if ("priorityLevel" in changes) properties["Priority Level"] = { select: changes.priorityLevel ? { name: changes.priorityLevel } : null };
  if ("energy" in changes) properties.Energy = { select: changes.energy ? { name: changes.energy } : null };
  if ("due" in changes) properties.Due = { date: dateValue(changes.due) };
  if ("scheduledFor" in changes) properties["Scheduled For"] = { date: dateValue(changes.scheduledFor) };
  if ("lastInteraction" in changes) properties["Last Interaction"] = { date: dateValue(changes.lastInteraction) };
  if ("completedAt" in changes) properties["Completed At"] = { date: dateValue(changes.completedAt) };
  if ("context" in changes) properties.Context = { multi_select: (changes.context || "").split(",").map((name) => name.trim()).filter(Boolean).map((name) => ({ name })) };
  if ("tags" in changes) properties.Tags = { multi_select: (changes.tags || "").split(",").map((name) => name.trim()).filter(Boolean).map((name) => ({ name })) };
  if ("originalNotes" in changes) properties["Original Notes"] = { rich_text: richText(changes.originalNotes) };
  if ("starred" in changes) properties.Starred = { checkbox: Boolean(changes.starred) };
  if ("showInTodoist" in changes) properties["Show in Todoist"] = { checkbox: Boolean(changes.showInTodoist) };
  if ("collection" in changes) properties["Legacy List"] = { select: changes.collection ? { name: changes.collection } : null };
  for (const [key, notionKey] of [["area", "Area"], ["project", "Project"], ["goal", "Goal"]] as const) {
    if (key in changes) {
      const id = relationId(changes[key]);
      properties[notionKey] = { relation: id ? [{ id }] : [] };
    }
  }
  return properties;
}

function todoistPriority(priority: number | null) {
  if (priority !== null && priority >= 8) return 1;
  if (priority !== null && priority >= 5) return 2;
  if (priority !== null && priority >= 2) return 3;
  return 4;
}

function dateKey(value: string | null) {
  if (!value) return null;
  const direct = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) return direct;
  const parsed = new Date(value.replace(/\s+\([A-Z]{2,5}\)$/, ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function belongsInToday(item: BoardItem) {
  if (["Done", "Archived"].includes(item.status)) return false;
  if (item.collection === "Today") return true;
  const today = new Date().toISOString().slice(0, 10);
  const planned = dateKey(item.scheduledFor) || dateKey(item.due);
  return Boolean(planned && planned <= today);
}

function todoistDue(item: BoardItem) {
  return dateKey(item.due) || dateKey(item.scheduledFor) || (item.collection === "Today" ? new Date().toISOString().slice(0, 10) : null);
}

async function patchNotionItem(token: string, item: BoardItem, changes: EditableChanges) {
  if (item.id.startsWith("local_")) throw new Error("This local item needs a full sync before Notion can update it.");
  const properties = notionProperties(changes);
  if (["originalNotes", "dateMode", "recurrence", "reminderTime"].some((key) => key in changes)) {
    properties["Original Notes"] = { rich_text: richText(notesWithReminderMetadata(item)) };
  }
  const body: Record<string, unknown> = { properties };
  if ("status" in changes) {
    if (changes.status === "Archived") {
      // Notion pages can be restored, so Archive is a quick, recoverable remove action.
      delete properties.Status;
      body.in_trash = true;
    } else {
      body.in_trash = false;
    }
  }
  await notionRequest(token, `/pages/${item.id}`, { method: "PATCH", body: JSON.stringify(body) });
}

async function createTodoistTask(token: string, item: BoardItem) {
  const due = todoistDue(item);
  return todoistRequest(token, "/tasks", {
    method: "POST",
    body: JSON.stringify({
      content: item.title,
      description: item.originalNotes || "Managed from Burner Board",
      priority: todoistPriority(item.priority),
      ...(due ? { due_date: due } : {}),
      labels: ["burner-board"],
    }),
  }) as Promise<{ id: string }>;
}

async function updateTodoistTask(token: string, item: BoardItem) {
  if (!item.todoistId) return;
  const body: Record<string, unknown> = {
    content: item.title,
    description: item.originalNotes || "Managed from Burner Board",
    priority: todoistPriority(item.priority),
  };
  body.due_date = todoistDue(item);
  await todoistRequest(token, `/tasks/${item.todoistId}`, { method: "POST", body: JSON.stringify(body) });
  if (item.status === "Done") await todoistRequest(token, `/tasks/${item.todoistId}/close`, { method: "POST" });
}

async function syncTodoistQueue(ownerId: string) {
  const token = await getIntegration(ownerId, "todoist");
  if (!token) return;
  const result = await runtime().DB.prepare(
    "SELECT * FROM items WHERE owner_id = ? AND show_in_todoist = 1 AND todoist_id IS NULL AND status NOT IN ('Done', 'Archived') LIMIT 100",
  ).bind(ownerId).all();
  const notionToken = await getIntegration(ownerId, "notion");
  for (const row of result.results || []) {
    const item = rowToItem(row);
    try {
      const created = await createTodoistTask(token, item);
      await runtime().DB.prepare(
        "UPDATE items SET todoist_id = ?, dirty = CASE WHEN ? IS NULL THEN dirty ELSE 0 END WHERE owner_id = ? AND id = ?",
      ).bind(created.id, notionToken ? 1 : null, ownerId, item.id).run();
      if (notionToken && !item.id.startsWith("local_")) {
        await notionRequest(notionToken, `/pages/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ properties: {
            "Show in Todoist": { checkbox: true },
            "Todoist ID": { rich_text: richText(created.id) },
          } }),
        });
      }
    } catch {
      // Keep the item queued. A later load or manual edit retries it.
    }
  }
}

async function findItem(ownerId: string, id: string) {
  const row = await runtime().DB.prepare("SELECT * FROM items WHERE owner_id = ? AND id = ?").bind(ownerId, id).first();
  if (!row) throw new Error("Item not found.");
  return rowToItem(row);
}

export async function updateItem(ownerId: string, id: string, changes: EditableChanges) {
  const before = await findItem(ownerId, id);
  const now = new Date().toISOString();
  const normalizedChanges: EditableChanges = { ...changes };
  normalizedChanges.lastInteraction = changes.lastInteraction || now;

  if (normalizedChanges.status === "Done" && before.status !== "Done") normalizedChanges.completedAt = now;
  if ("status" in normalizedChanges && normalizedChanges.status !== "Done" && before.completedAt) normalizedChanges.completedAt = null;
  if (normalizedChanges.status === "Archived") normalizedChanges.showInTodoist = false;

  const nonPriorityTypes = ["Goal", "Reminder", "Purchase", "List item", "Someday", "Reference"];
  if (normalizedChanges.itemType && nonPriorityTypes.includes(normalizedChanges.itemType) && !("priority" in normalizedChanges)) {
    normalizedChanges.priority = 0;
  }
  if (normalizedChanges.recurrence && !("itemType" in normalizedChanges)) {
    normalizedChanges.itemType = "Reminder";
    if (!("priority" in normalizedChanges)) normalizedChanges.priority = 0;
  }
  if (normalizedChanges.dateMode === "no_date") normalizedChanges.due = null;
  if (normalizedChanges.due) normalizedChanges.dateMode = "date_set";
  if ("priority" in normalizedChanges) {
    normalizedChanges.priority = normalizedPriority(normalizedChanges.priority);
    normalizedChanges.burner = burnerForPriority(normalizedChanges.priority);
  }

  const planned = { ...before, ...normalizedChanges } as BoardItem;
  if (!before.showInTodoist && belongsInToday(planned)) normalizedChanges.showInTodoist = true;

  const entries = Object.entries(normalizedChanges).filter(([key]) => COLUMN_MAP[key]);
  const sets = entries.map(([key]) => `${COLUMN_MAP[key]} = ?`);
  const values = entries.map(([, value]) => typeof value === "boolean" ? (value ? 1 : 0) : nullable(value));
  await runtime().DB.prepare(
    `UPDATE items SET ${sets.join(", ")}, dirty = 1, updated_at = CURRENT_TIMESTAMP WHERE owner_id = ? AND id = ?`,
  ).bind(...values, ownerId, id).run();

  let item = await findItem(ownerId, id);
  const sync: { notion: boolean | null; todoist: boolean | null; message?: string } = { notion: null, todoist: null };
  const notionToken = await getIntegration(ownerId, "notion");
  if (notionToken) {
    try {
      await patchNotionItem(notionToken, item, normalizedChanges);
      await runtime().DB.prepare("UPDATE items SET dirty = 0 WHERE owner_id = ? AND id = ?").bind(ownerId, id).run();
      sync.notion = true;
    } catch (error) {
      sync.notion = false;
      sync.message = error instanceof Error ? error.message : "Notion sync failed.";
    }
  }

  const todoistToken = await getIntegration(ownerId, "todoist");
  if (normalizedChanges.status === "Archived" && todoistToken && item.todoistId) {
    await todoistRequest(todoistToken, `/tasks/${item.todoistId}`, { method: "DELETE" });
    await runtime().DB.prepare("UPDATE items SET todoist_id = NULL WHERE owner_id = ? AND id = ?").bind(ownerId, id).run();
    sync.todoist = true;
  } else if ("showInTodoist" in normalizedChanges) {
    if (!todoistToken && normalizedChanges.showInTodoist) {
      sync.todoist = false;
      sync.message = "Connect Todoist to add this task there.";
    } else if (todoistToken && normalizedChanges.showInTodoist && !item.todoistId) {
      const created = await createTodoistTask(todoistToken, item);
      await runtime().DB.prepare("UPDATE items SET todoist_id = ? WHERE owner_id = ? AND id = ?").bind(created.id, ownerId, id).run();
      item = await findItem(ownerId, id);
      if (notionToken) await notionRequest(notionToken, `/pages/${item.id}`, { method: "PATCH", body: JSON.stringify({ properties: { "Todoist ID": { rich_text: richText(created.id) } } }) });
      sync.todoist = true;
    } else if (todoistToken && normalizedChanges.showInTodoist === false && item.todoistId) {
      await todoistRequest(todoistToken, `/tasks/${item.todoistId}`, { method: "DELETE" });
      await runtime().DB.prepare("UPDATE items SET todoist_id = NULL WHERE owner_id = ? AND id = ?").bind(ownerId, id).run();
      sync.todoist = true;
    }
  } else if (todoistToken && item.todoistId) {
    await updateTodoistTask(todoistToken, item);
    sync.todoist = true;
  }
  item = await findItem(ownerId, id);
  return { item, sync };
}

export async function createItem(ownerId: string, title: string) {
  const cleanTitle = title.trim();
  if (!cleanTitle) throw new Error("Type a task first.");
  const now = new Date().toISOString();
  const notionToken = await getIntegration(ownerId, "notion");
  let id = `local_${crypto.randomUUID()}`;
  let dirty = 1;
  if (notionToken) {
    const dataSources = notionDataSources();
    const created = await notionRequest(notionToken, "/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: dataSources.items },
        properties: notionProperties({ title: cleanTitle, status: "Not started", lastInteraction: now }),
      }),
    }) as { id: string };
    id = created.id.replaceAll("-", "");
    dirty = 0;
  }
  const raw = { id, title: cleanTitle, status: "Not started", itemType: "Task", source: "Burner Board", lastInteraction: now };
  await runtime().DB.prepare(
    `INSERT INTO items (owner_id, id, title, status, item_type, source, last_interaction, dirty, raw_json) VALUES (?, ?, ?, 'Not started', 'Task', 'Burner Board', ?, ?, ?)`,
  ).bind(ownerId, id, cleanTitle, now, dirty, JSON.stringify(raw)).run();
  return findItem(ownerId, id);
}

function propertyText(property: any) {
  if (!property) return null;
  if (property.type === "title") return property.title?.map((part: any) => part.plain_text || "").join("") || "";
  if (property.type === "rich_text") return property.rich_text?.map((part: any) => part.plain_text || "").join("") || "";
  if (property.type === "select") return property.select?.name || null;
  if (property.type === "status") return property.status?.name || null;
  if (property.type === "number") return property.number;
  if (property.type === "date") return property.date?.start || null;
  if (property.type === "checkbox") return Boolean(property.checkbox);
  if (property.type === "multi_select") return property.multi_select?.map((item: any) => item.name).join(", ") || null;
  if (property.type === "formula") {
    const formula = property.formula || {};
    return formula[formula.type] ?? null;
  }
  return null;
}

async function queryNotion(token: string, dataSourceId: string) {
  const pages: any[] = [];
  let cursor: string | undefined;
  do {
    const response = await notionRequest(token, `/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    }) as { results: any[]; has_more: boolean; next_cursor?: string };
    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return pages;
}

function relationDisplay(property: any, names: Map<string, string>) {
  if (!property?.relation?.length) return null;
  return property.relation.map((entry: any) => {
    const id = String(entry.id || "").replaceAll("-", "");
    const label = names.get(id) || "Linked item";
    return `${label} (https://www.notion.so/${id})`;
  }).join(", ");
}

async function relationNames(token: string, id: string, titleProperty: string) {
  const pages = await queryNotion(token, id);
  return new Map(pages.map((page) => [String(page.id).replaceAll("-", ""), propertyText(page.properties?.[titleProperty]) || "Linked item"]));
}

export async function syncNotion(ownerId: string) {
  const token = await getIntegration(ownerId, "notion");
  if (!token) throw new Error("Connect Notion first.");
  const dataSources = notionDataSources();
  const [pages, areas, projects, goals] = await Promise.all([
    queryNotion(token, dataSources.items),
    dataSources.areas ? relationNames(token, dataSources.areas, "Area") : new Map<string, string>(),
    dataSources.projects ? relationNames(token, dataSources.projects, "Project name") : new Map<string, string>(),
    dataSources.goals ? relationNames(token, dataSources.goals, "Goal") : new Map<string, string>(),
  ]);

  const db = runtime().DB;
  const statements = pages.map((page) => {
    const p = page.properties || {};
    const id = String(page.id).replaceAll("-", "");
    const reminder = parseReminderNotes(propertyText(p["Original Notes"]));
    const due = propertyText(p.Due);
    const notionItemType = propertyText(p["Item Type"]);
    const item = {
      id,
      title: propertyText(p["Task name"]) || "Untitled",
      status: propertyText(p.Status) || "Not started",
      burner: propertyText(p.Burner),
      priority: propertyText(p.Priority),
      priorityLevel: propertyText(p["Priority Level"]),
      itemType: reminder.recurrence && (!notionItemType || notionItemType === "Task") ? "Reminder" : notionItemType || "Task",
      source: propertyText(p.Source),
      collection: propertyText(p["Legacy List"]),
      due,
      scheduledFor: propertyText(p["Scheduled For"]),
      dateMode: reminder.dateMode || (due ? "date_set" : null),
      recurrence: reminder.recurrence,
      reminderTime: reminder.reminderTime,
      energy: propertyText(p.Energy),
      context: propertyText(p.Context),
      tags: propertyText(p.Tags),
      area: relationDisplay(p.Area, areas),
      project: relationDisplay(p.Project, projects),
      goal: relationDisplay(p.Goal, goals),
      originalNotes: reminder.notes,
      lastInteraction: propertyText(p["Last Interaction"]),
      lastNudge: propertyText(p["Last Nudge"]),
      completedAt: propertyText(p["Completed At"]),
      attentionScore: Number(propertyText(p["Attention Score"]) || 0),
      stalenessDays: Number(propertyText(p["Staleness (days)"]) || 0),
      starred: Boolean(propertyText(p.Starred)),
      todoistId: propertyText(p["Todoist ID"]),
      showInTodoist: Boolean(propertyText(p["Show in Todoist"])),
    };
    item.priority = importedPriority({
      priority: item.priority,
      burner: item.burner,
      itemType: item.itemType,
      collection: item.collection,
    });
    item.burner = burnerForPriority(item.priority);
    const values = itemValues(ownerId, item as unknown as StoredItem);
    const placeholders = ITEM_COLUMNS.map(() => "?").join(", ");
    return db.prepare(
      `INSERT INTO items (${ITEM_COLUMNS.join(", ")}) VALUES (${placeholders}) ON CONFLICT(owner_id, id) DO UPDATE SET title=excluded.title, status=excluded.status, burner=excluded.burner, priority=excluded.priority, priority_level=excluded.priority_level, item_type=excluded.item_type, source=excluded.source, collection=excluded.collection, due=excluded.due, scheduled_for=excluded.scheduled_for, date_mode=excluded.date_mode, recurrence=excluded.recurrence, reminder_time=excluded.reminder_time, energy=excluded.energy, context=excluded.context, area=excluded.area, project=excluded.project, goal=excluded.goal, original_notes=excluded.original_notes, last_interaction=excluded.last_interaction, last_nudge=excluded.last_nudge, completed_at=excluded.completed_at, attention_score=excluded.attention_score, staleness_days=excluded.staleness_days, starred=excluded.starred, todoist_id=excluded.todoist_id, show_in_todoist=excluded.show_in_todoist, raw_json=excluded.raw_json, dirty=0, updated_at=CURRENT_TIMESTAMP WHERE items.dirty=0`,
    ).bind(...values);
  });
  for (let index = 0; index < statements.length; index += 35) await db.batch(statements.slice(index, index + 35));
  return { pulled: pages.length };
}
