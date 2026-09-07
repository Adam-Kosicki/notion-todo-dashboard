import type { BoardItem, BoardList, EditableChanges, ListItemSort, ListRule } from "./board-types";

export const LIST_RULES: Array<{ value: ListRule; label: string; note: string }> = [
  { value: "manual", label: "Only items moved here", note: "Tasks you add or move into this list." },
  { value: "today", label: "Today and overdue", note: "Also shows tasks scheduled for today or overdue. Dropping here plans them for today." },
  { value: "week", label: "Rest of this week", note: "Also shows tasks planned after today through Sunday. Dropping here plans them for Sunday." },
  { value: "longer", label: "Later or unscheduled", note: "Also shows later and unscheduled tasks. Dropping here plans them for next week." },
  { value: "inbox", label: "Unfiled tasks (Inbox)", note: "Also catches tasks with no list, including quick captures. Move them to another list when ready." },
];
export const LIST_SORTS: Array<{ value: ListItemSort; label: string }> = [
  { value: "priority", label: "Importance: highest first" },
  { value: "attention", label: "Attention: highest first" },
  { value: "due", label: "Planned date: earliest first" },
  { value: "title", label: "Name: A–Z" },
  { value: "updated", label: "Recently updated" },
];

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function listCalendar(now = new Date()) {
  const end = new Date(now);
  end.setDate(end.getDate() + (7 - end.getDay()) % 7);
  const next = new Date(end);
  next.setDate(next.getDate() + 1);
  return { today: localDate(now), weekEnd: localDate(end), nextWeek: localDate(next) };
}

export function plannedDate(item: BoardItem) {
  return (item.scheduledFor || item.due || "").slice(0, 10);
}

export function belongsToList(item: BoardItem, list: BoardList, lists: BoardList[], now = new Date()) {
  if (item.collection === list.name) return true;
  const rule = list.rule || "manual";
  if (rule === "manual") return false;
  // An explicit move between date lists wins over automatic inclusion, even for overdue tasks.
  if (lists.some(other => other.name === item.collection && other.rule && other.rule !== "manual")) return false;
  const date = plannedDate(item);
  const { today, weekEnd } = listCalendar(now);
  if (rule === "inbox") return !item.collection;
  if (rule === "today") return Boolean(date && date <= today);
  if (rule === "week") return Boolean(date && date > today && date <= weekEnd);
  return date ? date > weekEnd : Boolean(item.collection || (item.priority ?? 0) > 0);
}

export function listMoveChanges(list: BoardList, now = new Date()): EditableChanges {
  const changes: EditableChanges = { collection: list.name };
  const { today, weekEnd, nextWeek } = listCalendar(now);
  if (list.rule === "today") { changes.scheduledFor = today; changes.showInTodoist = true; }
  if (list.rule === "week") changes.scheduledFor = weekEnd;
  if (list.rule === "longer") changes.scheduledFor = nextWeek;
  // Due dates describe commitments; moving a task never silently erases them.
  if (list.defaultItemType) changes.itemType = list.defaultItemType;
  return changes;
}

export function compareListItems(a: BoardItem, b: BoardItem, sort: ListItemSort = "priority", attention = (item: BoardItem) => item.attentionScore) {
  const completed = Number(["Done", "Archived"].includes(a.status)) - Number(["Done", "Archived"].includes(b.status));
  if (completed) return completed;
  let order = 0;
  if (sort === "priority") order = (b.priority ?? -1) - (a.priority ?? -1) || attention(b) - attention(a);
  if (sort === "attention") order = attention(b) - attention(a);
  if (sort === "due") order = (plannedDate(a) || "9999").localeCompare(plannedDate(b) || "9999");
  if (sort === "updated") order = b.updatedAt.localeCompare(a.updatedAt);
  return order || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

export function reorderedListIds(lists: BoardList[], draggedId: string, targetId: string) {
  const ordered = [...lists].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const from = ordered.findIndex(list => list.id === draggedId);
  const to = ordered.findIndex(list => list.id === targetId);
  if (from < 0 || to < 0 || from === to) return ordered.map(list => list.id);
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);
  return ordered.map(list => list.id);
}
