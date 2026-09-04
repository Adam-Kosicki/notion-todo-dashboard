"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  Archive,
  ArrowUpDown,
  BellRing,
  CalendarClock,
  CalendarPlus,
  CalendarX2,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Download,
  ExternalLink,
  Flame,
  Gift,
  Gauge,
  GripVertical,
  History,
  ListChecks,
  Loader2,
  PackageOpen,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShoppingCart,
  Sparkles,
  Target,
  Trash2,
  Trophy,
  Unplug,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { LIST_TYPES, listTypeDefaults, type BoardItem, type BoardList, type BoardPayload, type EditableChanges, type EditableList, type RelationOption } from "@/lib/board-types";

type BoardMode = "dashboard" | "prioritize" | "collections" | "reminders" | "completed";

const STATUSES = ["Not started", "In progress", "Done", "Archived"];
const ITEM_TYPES = ["Task", "Goal", "Reminder", "Purchase", "List item", "Someday", "Reference"];
const ENERGIES = ["High focus", "Medium", "Low / admin"];
const CONTEXTS = ["Computer", "Phone", "Errands", "Home", "Anywhere"];
const RECURRENCES = ["Daily", "Weekdays", "Weekly", "Monthly", "Yearly", "Custom"];
const DATE_MODES = [
  { value: "unspecified", label: "Date undecided" },
  { value: "needs_date", label: "Needs a date" },
  { value: "no_date", label: "No date needed" },
  { value: "date_set", label: "Date set" },
];
const COLLECTION_ORDER = [
  "Important todo",
  "Today",
  "Grocery",
  "Wish List",
  "Health",
  "Career",
  "Projects",
  "Goals",
  "Bucket List",
  "Later",
  "Bills",
  "Warranties",
  "Unsorted",
];

async function boardRequest(body?: unknown) {
  const response = await fetch("/api/board", body ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } : undefined);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The board could not finish that change.");
  return payload;
}

function shortRelation(value: string | null) {
  return value?.replace(/\s*\(https?:\/\/[^)]+\)\s*$/, "") || "";
}

function inputDate(value: string | null) {
  if (!value) return "";
  const direct = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) return direct;
  const parsed = new Date(value.replace(/\s+\([A-Z]{2,5}\)$/, ""));
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function dueLabel(value: string | null) {
  if (!value) return null;
  const date = inputDate(value);
  if (!date) return value;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00`);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return target.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function effectiveAttention(item: BoardItem) {
  const dates = [inputDate(item.due), inputDate(item.scheduledFor)].filter(Boolean).sort();
  const date = dates[0];
  if (!date) return item.attentionScore;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00`);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  const dueFloor = days < 0 ? 75 : days === 0 ? 60 : days === 1 ? 50 : days <= 3 ? 42 : days <= 7 ? 32 : days <= 14 ? 20 : 0;
  return Math.max(item.attentionScore, dueFloor);
}

function localIso(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekEndIso() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  const remaining = (7 - date.getDay()) % 7;
  date.setDate(date.getDate() + (remaining || 7));
  return localIso(date);
}

function itemDates(item: BoardItem) {
  const planned = inputDate(item.scheduledFor) || inputDate(item.due);
  return planned ? [planned] : [];
}

function isTodayItem(item: BoardItem) {
  if (item.collection === "Today") return true;
  const today = localIso();
  return itemDates(item).some((date) => date <= today);
}

function isThisWeekItem(item: BoardItem) {
  if (isTodayItem(item)) return false;
  const today = localIso();
  const weekEnd = weekEndIso();
  return itemDates(item).some((date) => date > today && date <= weekEnd);
}

function needsPriority(item: BoardItem) {
  return item.priority === null
    && item.itemType === "Task"
    && !item.collection
    && !item.area
    && !item.project
    && !item.goal
    && !item.context;
}

function usesPriority(itemType: string) {
  return itemType === "Task";
}

function attentionHeat(item: BoardItem) {
  return Math.min(100, Math.max((item.priority ?? 0) * 10, effectiveAttention(item)));
}

function heatColor(item: BoardItem) {
  const hue = Math.round(118 - (attentionHeat(item) / 100) * 118);
  return `hsl(${hue} 72% 54%)`;
}

function tagColor(name: string) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) % 360;
  return `hsl(${hash} 62% 52%)`;
}

function tagList(value: string | null) {
  return (value || "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

function attentionSort(a: BoardItem, b: BoardItem) {
  return effectiveAttention(b) - effectiveAttention(a)
    || (b.priority ?? -1) - (a.priority ?? -1)
    || (itemDates(a)[0] || "9999").localeCompare(itemDates(b)[0] || "9999")
    || a.title.localeCompare(b.title);
}

function urgencySort(a: BoardItem, b: BoardItem) {
  return attentionHeat(b) - attentionHeat(a)
    || effectiveAttention(b) - effectiveAttention(a)
    || (b.priority ?? -1) - (a.priority ?? -1)
    || (itemDates(a)[0] || "9999").localeCompare(itemDates(b)[0] || "9999")
    || a.title.localeCompare(b.title);
}

function sourceClass(source: string | null) {
  if (source === "Apple Reminders") return "source-apple";
  if (source === "Obsidian") return "source-obsidian";
  if (source === "Todoist") return "source-todoist";
  if (source === "Burner Board") return "source-board";
  return "source-google";
}

function collectionIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("grocery")) return ShoppingCart;
  if (lower.includes("wish")) return Gift;
  if (lower.includes("payment")) return WalletCards;
  if (lower.includes("goal") || lower.includes("priorit")) return Target;
  if (lower.includes("bucket") || lower.includes("later")) return Archive;
  return ListChecks;
}

function PriorityControl({
  item,
  onChange,
  compact = false,
}: {
  item: BoardItem;
  onChange: (priority: number) => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(item.priority ?? 0);
  const commit = () => {
    if (draft !== item.priority) onChange(draft);
  };
  return (
    <div
      className={compact ? "priority-control compact" : "priority-control"}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="priority-control-label">
        <span>{item.priority === null && draft === 0 ? "Set importance" : draft === 0 ? "List / goal" : "Importance"}</span>
        <strong>{draft}</strong>
      </div>
      <input
        aria-label={`Importance for ${item.title}: ${draft} out of 10`}
        draggable={false}
        max={10}
        min={0}
        onBlur={commit}
        onChange={(event) => setDraft(Number(event.target.value))}
        onKeyUp={commit}
        onPointerUp={commit}
        step={1}
        type="range"
        value={draft}
      />
      <div className="priority-scale"><span>0 · list</span><span>5</span><span>10 · now</span></div>
    </div>
  );
}

function DateQuickPopover({ item, onSave }: {
  item: BoardItem;
  onSave: (id: string, changes: EditableChanges) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = inputDate(item.due);
  const selected = current ? new Date(`${current}T00:00:00`) : undefined;
  const setDate = (date: Date | undefined) => {
    const iso = date ? localIso(date) : null;
    onSave(item.id, { due: iso, dateMode: iso ? "date_set" : "unspecified" });
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={current ? "has-date" : ""}
          onClick={(event) => event.stopPropagation()}
        >
          {current ? <CalendarClock /> : <CalendarPlus />}
          {current ? dueLabel(item.due) : "Add date"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="date-quick-popover" onClick={(event) => event.stopPropagation()}>
        <Calendar mode="single" selected={selected} onSelect={setDate} />
        {current && <button type="button" className="date-clear" onClick={() => setDate(undefined)}><CalendarX2 />Clear date</button>}
      </PopoverContent>
    </Popover>
  );
}

function TagPicker({ value, allTags, onChange }: {
  value: string | null;
  allTags: string[];
  onChange: (next: string | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const selected = tagList(value);
  const selectedSet = new Set(selected);
  const commit = (next: string[]) => onChange(next.length ? next.join(", ") : null);
  const toggle = (tag: string) => commit(selectedSet.has(tag) ? selected.filter((entry) => entry !== tag) : [...selected, tag]);
  const addDraft = () => {
    const tag = draft.trim();
    if (!tag) return;
    if (!selectedSet.has(tag)) commit([...selected, tag]);
    setDraft("");
  };
  const available = allTags.filter((tag) => !selectedSet.has(tag));
  return (
    <div className="tag-picker" onClick={(event) => event.stopPropagation()}>
      <div className="tag-blobs">
        {selected.map((tag) => (
          <button key={tag} type="button" className="tag-blob selected" style={{ "--tag-color": tagColor(tag) } as CSSProperties} onClick={() => toggle(tag)}>
            {tag}<X />
          </button>
        ))}
        {available.map((tag) => (
          <button key={tag} type="button" className="tag-blob" style={{ "--tag-color": tagColor(tag) } as CSSProperties} onClick={() => toggle(tag)}>
            {tag}
          </button>
        ))}
      </div>
      <div className="tag-add-row">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="New tag..." onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addDraft(); } }} />
        <button type="button" onClick={addDraft} disabled={!draft.trim()}>Add</button>
      </div>
    </div>
  );
}

function QuickEditor({ item, collections, allTags, onSave }: {
  item: BoardItem;
  collections: string[];
  allTags: string[];
  onSave: (id: string, changes: EditableChanges) => void;
}) {
  const commitText = (key: "title" | "originalNotes" | "collection", value: string) => {
    const next = value.trim();
    const current = key === "title" ? item.title : item[key] || "";
    if (next !== current && (key !== "title" || next)) onSave(item.id, { [key]: next || null });
  };
  const dateMode = item.dateMode || (item.due ? "date_set" : "unspecified");
  return (
    <div className="quick-editor" onClick={(event) => event.stopPropagation()}>
      <div className="quick-editor-inner">
        <label className="quick-field quick-title-field"><span>Name</span><input key={`${item.updatedAt}:title`} defaultValue={item.title} onBlur={(event) => commitText("title", event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
        <label className="quick-field"><span>Due date</span><input key={`${item.updatedAt}:due`} type="date" defaultValue={inputDate(item.due)} onChange={(event) => onSave(item.id, { due: event.currentTarget.value || null, dateMode: event.currentTarget.value ? "date_set" : "unspecified" })} /></label>
        <label className="quick-field"><span>Date rule</span><select value={dateMode} onChange={(event) => onSave(item.id, { dateMode: event.currentTarget.value, ...(event.currentTarget.value === "no_date" ? { due: null, scheduledFor: null } : {}) })}>{DATE_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label>
        <label className="quick-field"><span>List</span><input key={`${item.updatedAt}:collection`} list={`collections-${item.id}`} defaultValue={item.collection || ""} placeholder="No list" onBlur={(event) => commitText("collection", event.currentTarget.value)} /><datalist id={`collections-${item.id}`}>{collections.map((collection) => <option key={collection} value={collection} />)}</datalist></label>
        <label className="quick-field"><span>Type</span><select value={item.itemType} onChange={(event) => onSave(item.id, { itemType: event.currentTarget.value, ...(!usesPriority(event.currentTarget.value) ? { priority: 0 } : {}) })}>{ITEM_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <label className="quick-field quick-details-field"><span>Details</span><input key={`${item.updatedAt}:notes`} defaultValue={item.originalNotes || ""} placeholder="Add a short note" onBlur={(event) => commitText("originalNotes", event.currentTarget.value)} /></label>
        {item.itemType === "Reminder" && <>
          <label className="quick-field"><span>Repeat</span><select value={item.recurrence || ""} onChange={(event) => onSave(item.id, { recurrence: event.currentTarget.value || null })}><option value="">Does not repeat</option>{RECURRENCES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="quick-field"><span>Time</span><input type="time" value={item.reminderTime || ""} onChange={(event) => onSave(item.id, { reminderTime: event.currentTarget.value || null })} /></label>
        </>}
        <label className="quick-field quick-tags-field"><span>Tags</span><TagPicker allTags={allTags} value={item.tags} onChange={(next) => onSave(item.id, { tags: next })} /></label>
        {usesPriority(item.itemType) && <div className="quick-priority"><PriorityControl item={item} key={`${item.id}:${item.priority ?? "unrated"}:quick`} onChange={(priority) => onSave(item.id, { priority })} /></div>}
      </div>
    </div>
  );
}

function TaskRow({ item, collections, allTags, completed = false, onOpen, onSave }: {
  item: BoardItem;
  collections: string[];
  allTags: string[];
  completed?: boolean;
  onOpen: (item: BoardItem) => void;
  onSave: (id: string, changes: EditableChanges) => void;
}) {
  const done = ["Done", "Archived"].includes(item.status);
  const date = completed ? dueLabel(item.completedAt) : dueLabel(item.due || item.scheduledFor);
  const attention = Math.round(effectiveAttention(item));
  return (
    <article
      className={`${done ? "dashboard-row is-done" : "dashboard-row"} ${item.dirty ? "is-dirty" : ""}`}
      draggable
      onDragStart={(event) => {
        if ((event.target as HTMLElement).closest("button, input, select, .priority-control")) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.id);
      }}
      style={{ "--heat-color": heatColor(item) } as CSSProperties}
    >
      <div className="dashboard-row-main">
        <button aria-label={done ? `Reopen ${item.title}` : `Complete ${item.title}`} className="check-button" onClick={() => onSave(item.id, { status: done ? "Not started" : "Done" })} type="button">{done ? <CheckCircle2 /> : <span />}</button>
        <GripVertical className="dashboard-drag" aria-hidden="true" />
        <button className="dashboard-title" onClick={() => onOpen(item)} type="button">
          <strong>{item.title}</strong>
          <span><i className={`source-dot ${sourceClass(item.source)}`} />{item.collection || shortRelation(item.area) || shortRelation(item.project) || item.itemType}{item.showInTodoist && <em className="todoist-mark">T</em>}
            {tagList(item.tags).map((tag) => <em key={tag} className="tag-pill" style={{ "--tag-color": tagColor(tag) } as CSSProperties}>{tag}</em>)}
          </span>
        </button>
        <span className={date?.includes("overdue") ? "dashboard-due overdue" : "dashboard-due"}>{date || "—"}</span>
        <span className="heat-score" title={`Combined urgency ${Math.round(attentionHeat(item))}`}><i />{attention}</span>
        {usesPriority(item.itemType) ? <>
          <span className={item.priority === null ? "row-score unrated" : item.priority === 0 ? "row-score zero" : "row-score"}>{item.priority === null ? "—" : item.priority}</span>
          <PriorityControl compact item={item} key={`${item.id}:${item.priority ?? "unrated"}:dashboard`} onChange={(priority) => onSave(item.id, { priority })} />
        </> : <span className="non-priority-type">{item.itemType}</span>}
        <button className="row-open" onClick={() => onOpen(item)} type="button" aria-label={`Open all details for ${item.title}`}><ChevronRight /></button>
      </div>
      <div className="quick-toolbar" aria-label={`Quick actions for ${item.title}`}>
        <button type="button" onClick={() => onSave(item.id, { status: done ? "Not started" : "Done" })}><CheckCircle2 />{done ? "Reopen" : "Done"}</button>
        <button type="button" onClick={() => onSave(item.id, { lastInteraction: new Date().toISOString() })}><Sparkles />Active</button>
        <DateQuickPopover item={item} onSave={onSave} />
        <button type="button" className="archive-action" onClick={() => onSave(item.id, { status: "Archived" })}><Archive />Archive</button>
      </div>
      <QuickEditor item={item} collections={collections} allTags={allTags} onSave={onSave} />
    </article>
  );
}

function TaskTable({ title, note, items, icon: Icon, empty, collections, allTags, completed = false, onOpen, onSave, onDrop }: {
  title: string;
  note: string;
  items: BoardItem[];
  icon: typeof Flame;
  empty: string;
  collections: string[];
  allTags: string[];
  completed?: boolean;
  onOpen: (item: BoardItem) => void;
  onSave: (id: string, changes: EditableChanges) => void;
  onDrop?: (id: string) => void;
}) {
  return (
    <section className="task-table-panel" onDragOver={(event) => { if (onDrop) event.preventDefault(); }} onDrop={(event) => { if (!onDrop) return; event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); if (id) onDrop(id); }}>
      <header className="task-table-head"><span className="task-table-icon"><Icon /></span><span><h2>{title}</h2><p>{note}</p></span><span className="task-table-count">{items.length}</span></header>
      <div className="task-table-columns" aria-hidden="true"><span>Task</span><span>{completed ? "Finished" : "Due"}</span><span>Attention</span><span>Priority</span><span /></div>
      <div className="task-table-body">
        {items.map((item) => <TaskRow allTags={allTags} completed={completed} item={item} collections={collections} key={item.id} onOpen={onOpen} onSave={onSave} />)}
        {!items.length && <div className="task-table-empty"><Check /><span>{empty}</span></div>}
      </div>
    </section>
  );
}

function ListManagePopover({ list, itemCount, onSave, onDelete }: {
  list: BoardList;
  itemCount: number;
  onSave: (id: string, changes: EditableList) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const typeDefaults = listTypeDefaults(list.type);
  const priorityMode = list.showPriority === null ? "default" : list.showPriority ? "on" : "off";
  const goalsMode = list.showLongTermGoals === null ? "default" : list.showLongTermGoals ? "on" : "off";
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setConfirmDelete(false); }}>
      <PopoverTrigger asChild>
        <button type="button" className="list-manage-trigger" aria-label={`Manage ${list.name}`} onClick={(event) => event.stopPropagation()}><Settings2 /></button>
      </PopoverTrigger>
      <PopoverContent align="end" className="list-manage-popover" onClick={(event) => event.stopPropagation()}>
        <label className="quick-field">
          <span>Name</span>
          <input key={`${list.id}:name`} defaultValue={list.name} onBlur={(event) => { const value = event.currentTarget.value.trim(); if (value && value !== list.name) onSave(list.id, { name: value }); }} />
        </label>
        <label className="quick-field">
          <span>List type</span>
          <select value={list.type} onChange={(event) => onSave(list.id, { type: event.currentTarget.value })}>
            {LIST_TYPES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
        </label>
        <div className="list-toggle-row">
          <span>Priority slider</span>
          <div className="tri-toggle">
            <button type="button" className={priorityMode === "default" ? "selected" : ""} onClick={() => onSave(list.id, { showPriority: null })}>Default ({typeDefaults.showPriority ? "on" : "off"})</button>
            <button type="button" className={priorityMode === "on" ? "selected" : ""} onClick={() => onSave(list.id, { showPriority: true })}>On</button>
            <button type="button" className={priorityMode === "off" ? "selected" : ""} onClick={() => onSave(list.id, { showPriority: false })}>Off</button>
          </div>
        </div>
        {(list.showPriority ?? typeDefaults.showPriority) && (
          <div className="list-toggle-row">
            <span>Long-term goals section</span>
            <div className="tri-toggle">
              <button type="button" className={goalsMode === "default" ? "selected" : ""} onClick={() => onSave(list.id, { showLongTermGoals: null })}>Default ({typeDefaults.showLongTermGoals ? "on" : "off"})</button>
              <button type="button" className={goalsMode === "on" ? "selected" : ""} onClick={() => onSave(list.id, { showLongTermGoals: true })}>On</button>
              <button type="button" className={goalsMode === "off" ? "selected" : ""} onClick={() => onSave(list.id, { showLongTermGoals: false })}>Off</button>
            </div>
          </div>
        )}
        {typeDefaults.hasReminderDefault && (
          <label className="quick-field">
            <span>Default reminder</span>
            <input key={`${list.id}:reminder`} defaultValue={list.reminderDefault || ""} placeholder="e.g. Monthly on the 1st" onBlur={(event) => { const value = event.currentTarget.value.trim(); if (value !== (list.reminderDefault || "")) onSave(list.id, { reminderDefault: value || null }); }} />
          </label>
        )}
        {confirmDelete ? (
          <div className="list-delete-confirm">
            <p>{itemCount ? `${itemCount} task${itemCount === 1 ? "" : "s"} will move to no list.` : "This list is empty."}</p>
            <div>
              <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button type="button" className="danger" onClick={() => { onDelete(list.id); setOpen(false); }}>Delete list</button>
            </div>
          </div>
        ) : (
          <button type="button" className="list-delete-trigger" onClick={() => setConfirmDelete(true)}><Trash2 />Delete list</button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function NewListCard({ onCreate }: { onCreate: (name: string, type: string) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("general");
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, type);
    setName("");
  };
  return (
    <section className="collection-card new-list-card">
      <header className="collection-head">
        <span className="collection-icon"><Plus /></span>
        <span><h2>New list</h2><p>Create a list to organize tasks</p></span>
      </header>
      <div className="new-list-form">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="List name" onKeyDown={(event) => { if (event.key === "Enter") submit(); }} />
        <select value={type} onChange={(event) => setType(event.target.value)}>
          {LIST_TYPES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </select>
        <button type="button" disabled={!name.trim()} onClick={submit}>Create list</button>
      </div>
    </section>
  );
}

function CollectionsView({
  items,
  lists,
  onOpen,
  onStatus,
  onPriority,
  onMove,
  onCreateList,
  onSaveList,
  onDeleteList,
}: {
  items: BoardItem[];
  lists: BoardList[];
  onOpen: (item: BoardItem) => void;
  onStatus: (item: BoardItem) => void;
  onPriority: (id: string, priority: number) => void;
  onMove: (id: string, changes: EditableChanges) => void;
  onCreateList: (name: string, type: string) => void;
  onSaveList: (id: string, changes: EditableList) => void;
  onDeleteList: (id: string) => void;
}) {
  const listsByName = useMemo(() => new Map(lists.map((list) => [list.name, list])), [lists]);
  const groups = new Map<string, BoardItem[]>();
  for (const list of lists) groups.set(list.name, []);
  for (const item of items) {
    if (!item.collection && item.priority !== 0) continue;
    const name = item.collection || item.source || item.itemType || "Other";
    const group = groups.get(name) || [];
    group.push(item);
    groups.set(name, group);
  }
  const order = [...groups.keys()].sort((a, b) => {
    const left = COLLECTION_ORDER.indexOf(a);
    const right = COLLECTION_ORDER.indexOf(b);
    if (left !== -1 || right !== -1) {
      if (left === -1) return 1;
      if (right === -1) return -1;
      return left - right;
    }
    return a.localeCompare(b);
  });

  return (
    <div className="collections-grid">
      <NewListCard onCreate={onCreateList} />
      {!order.length && <div className="collections-empty"><PackageOpen /><h2>No collection items match these filters</h2><p>Try Open items or clear the search.</p></div>}
      {order.map((name) => {
        const Icon = collectionIcon(name);
        const list = listsByName.get(name) || null;
        const typeDefaults = listTypeDefaults(list?.type || "general");
        const showPriority = list?.showPriority ?? typeDefaults.showPriority;
        const showLongTermGoals = list?.showLongTermGoals ?? typeDefaults.showLongTermGoals;
        const group = (groups.get(name) || []).sort((a, b) => {
          const done = Number(["Done", "Archived"].includes(a.status)) - Number(["Done", "Archived"].includes(b.status));
          return done || (b.priority ?? -1) - (a.priority ?? -1) || effectiveAttention(b) - effectiveAttention(a) || a.title.localeCompare(b.title);
        });
        const openCount = group.filter((item) => !["Done", "Archived"].includes(item.status)).length;
        const prioritized = group.filter((item) => item.priority !== null && item.priority > 0);
        const unrated = group.filter((item) => item.priority === null);
        const longGoals = group.filter((item) => item.priority === 0 && item.itemType === "Goal");
        const longItems = group.filter((item) => item.priority === 0 && item.itemType !== "Goal");
        const row = (item: BoardItem) => {
          const done = ["Done", "Archived"].includes(item.status);
          const due = dueLabel(item.due || item.scheduledFor);
          return (
            <article
              className={done ? "collection-row is-done" : "collection-row"}
              draggable
              key={item.id}
              onDragStart={(event) => {
                if ((event.target as HTMLElement).closest(".priority-control")) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.id);
              }}
              style={{ "--heat-color": heatColor(item) } as CSSProperties}
            >
              <button
                aria-label={done ? `Mark ${item.title} not started` : `Complete ${item.title}`}
                className="check-button"
                onClick={() => onStatus(item)}
                type="button"
              >
                {done ? <CheckCircle2 /> : <span />}
              </button>
              <button className="collection-title" onClick={() => onOpen(item)} type="button">
                <strong>{item.title}</strong>
                <span>
                  {item.itemType}
                  {due && <><i>·</i><em className={due.includes("overdue") ? "overdue" : ""}>{due}</em></>}
                  {effectiveAttention(item) > 0.25 && <><i>·</i><em>Attention {Math.round(effectiveAttention(item))}</em></>}
                </span>
              </button>
              {showPriority ? <>
                <span className={item.priority === null ? "row-score unrated" : item.priority === 0 ? "row-score zero" : "row-score"}>
                  {item.priority === null ? "?" : item.priority}
                </span>
                <PriorityControl
                  compact
                  item={item}
                  key={`${item.id}:${item.priority ?? "unrated"}:collection`}
                  onChange={(priority) => onPriority(item.id, priority)}
                />
              </> : <span className="non-priority-type">{item.itemType}</span>}
              <button className="row-open" onClick={() => onOpen(item)} type="button" aria-label={`Edit ${item.title}`}><ChevronRight /></button>
            </article>
          );
        };
        const subtable = (label: string, rows: BoardItem[], changes: EditableChanges, kind: string, always = false) => {
          if (!rows.length && !always) return null;
          return (
            <section
              className={`collection-subtable subtable-${kind}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const id = event.dataTransfer.getData("text/plain");
                if (id) onMove(id, { collection: name, ...changes });
              }}
            >
              <header><span>{label}</span><small>{rows.length}</small></header>
              <div className="collection-table">
                {rows.map(row)}
                {!rows.length && <div className="subtable-empty">Drop a row here</div>}
              </div>
            </section>
          );
        };
        return (
          <section
            className="collection-card"
            key={name}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData("text/plain");
              if (id) onMove(id, showPriority ? { collection: name } : { collection: name, priority: 0 });
            }}
          >
            <header className="collection-head">
              <span className="collection-icon"><Icon /></span>
              <span><h2>{name}</h2><p>{openCount} open · {group.length} shown</p></span>
              {list && <ListManagePopover list={list} itemCount={group.length} onSave={onSaveList} onDelete={onDeleteList} />}
              <span className="drop-note">Drop here</span>
            </header>
            <div className="collection-subtables">
              {showPriority ? <>
                {subtable("Prioritized", prioritized, {}, "priority")}
                {subtable("No priority", unrated, { priority: null }, "unrated", true)}
                {showLongTermGoals && subtable("Long-term goals", longGoals, { priority: 0, itemType: "Goal" }, "goals", true)}
                {subtable(showLongTermGoals ? "Long-term tasks + items" : "Long-term + everything else", longItems, { priority: 0, itemType: "Task" }, "long", true)}
              </> : subtable("Items", group, {}, "flat", true)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function FieldLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return <label className="field-label"><span>{children}</span>{hint && <small>{hint}</small>}</label>;
}

function RelationSelect({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string | null;
  options: RelationOption[];
  placeholder: string;
  onChange: (value: string | null) => void;
}) {
  return (
    <Select value={value || "__none__"} onValueChange={(next) => onChange(next === "__none__" ? null : next)}>
      <SelectTrigger className="field-control"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent position="popper">
        <SelectItem value="__none__">None</SelectItem>
        {options.map((option) => <SelectItem key={option.id} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function EditorSheet({
  item,
  open,
  relations,
  collections,
  connections,
  onOpenChange,
  onSave,
  onNeedConnection,
}: {
  item: BoardItem | null;
  open: boolean;
  relations: BoardPayload["relations"];
  collections: string[];
  connections: BoardPayload["connections"];
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, changes: EditableChanges) => Promise<void>;
  onNeedConnection: () => void;
}) {
  const [removeTodoist, setRemoveTodoist] = useState(false);
  if (!item) return null;

  const save = (changes: EditableChanges) => onSave(item.id, changes);
  const contextValues = new Set((item.context || "").split(",").map((value) => value.trim()).filter(Boolean));
  const collectionOptions = item.collection && !collections.includes(item.collection) ? [item.collection, ...collections] : collections;
  const toggleContext = (value: string) => {
    const next = new Set(contextValues);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    void save({ context: [...next].join(", ") || null });
  };
  const toggleTodoist = (checked: boolean) => {
    if (checked && !connections.todoist) {
      onNeedConnection();
      toast.info("Connect Todoist first. Your task has not been copied yet.");
      return;
    }
    if (!checked && item.todoistId) {
      setRemoveTodoist(true);
      return;
    }
    void save({ showInTodoist: checked });
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="editor-sheet sm:max-w-xl" side="right">
          <SheetHeader className="editor-header">
            <SheetDescription>{item.itemType} · {item.source || "No source"}</SheetDescription>
            <SheetTitle className="sr-only">Edit task</SheetTitle>
            <textarea
              className="title-editor"
              defaultValue={item.title}
              key={`${item.id}-title`}
              rows={2}
              onBlur={(event) => {
                const next = event.currentTarget.value.trim();
                if (next && next !== item.title) void save({ title: next });
              }}
            />
          </SheetHeader>

          <div className="editor-scroll">
            <div className="switch-row todoist-switch">
              <span><strong>Show in Todoist</strong><small>Today items turn this on automatically.</small></span>
              <Switch checked={item.showInTodoist} onCheckedChange={toggleTodoist} aria-label="Show in Todoist" />
            </div>
            {!connections.todoist && <button className="connection-nudge" type="button" onClick={onNeedConnection}><Unplug />Connect Todoist to use this switch</button>}

            {usesPriority(item.itemType) && <section className="editor-section priority-editor">
              <h3>Importance</h3>
              <PriorityControl
                item={item}
                key={`${item.id}:${item.priority ?? "unrated"}:editor`}
                onChange={(priority) => void save({ priority })}
              />
              <div className="priority-guide">
                <span><strong>0</strong>List or long-term goal</span>
                <span><strong>1–3</strong>Later</span>
                <span><strong>4–7</strong>Next</span>
                <span><strong>8–10</strong>Now</span>
              </div>
            </section>}

            <section className="editor-section">
              <h3>Organize</h3>
              <div className="field-grid two">
                <div>
                  <FieldLabel>Status</FieldLabel>
                  <Select value={item.status} onValueChange={(value) => void save({ status: value })}>
                    <SelectTrigger className="field-control"><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <FieldLabel>Collection</FieldLabel>
                  <Select value={item.collection || "__none__"} onValueChange={(value) => void save({ collection: value === "__none__" ? null : value })}>
                    <SelectTrigger className="field-control"><SelectValue placeholder="No collection" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No collection</SelectItem>
                      {collectionOptions.map((collection) => <SelectItem key={collection} value={collection}>{collection}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <FieldLabel>Item type</FieldLabel>
                  <Select value={item.itemType} onValueChange={(value) => void save({ itemType: value })}>
                    <SelectTrigger className="field-control"><SelectValue /></SelectTrigger>
                    <SelectContent>{ITEM_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <section className="editor-section">
              <h3>Plan it</h3>
              <div className="field-grid two">
                <div><FieldLabel>Due</FieldLabel><input className="field-control" type="date" value={inputDate(item.due)} onChange={(event) => void save({ due: event.target.value || null })} /></div>
                <div><FieldLabel>Scheduled</FieldLabel><input className="field-control" type="date" value={inputDate(item.scheduledFor)} onChange={(event) => void save({ scheduledFor: event.target.value || null })} /></div>
                <div>
                  <FieldLabel>Date rule</FieldLabel>
                  <Select value={item.dateMode || (item.due ? "date_set" : "unspecified")} onValueChange={(value) => void save({ dateMode: value, ...(value === "no_date" ? { due: null, scheduledFor: null } : {}) })}>
                    <SelectTrigger className="field-control"><SelectValue /></SelectTrigger>
                    <SelectContent>{DATE_MODES.map((mode) => <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {item.itemType === "Reminder" && <>
                  <div>
                    <FieldLabel>Repeat</FieldLabel>
                    <Select value={item.recurrence || "__none__"} onValueChange={(value) => void save({ recurrence: value === "__none__" ? null : value })}>
                      <SelectTrigger className="field-control"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="__none__">Does not repeat</SelectItem>{RECURRENCES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><FieldLabel>Reminder time</FieldLabel><input className="field-control" type="time" value={item.reminderTime || ""} onChange={(event) => void save({ reminderTime: event.target.value || null })} /></div>
                </>}
              </div>
              <FieldLabel>Energy</FieldLabel>
              <Select value={item.energy || "__none__"} onValueChange={(value) => void save({ energy: value === "__none__" ? null : value })}>
                <SelectTrigger className="field-control"><SelectValue placeholder="Choose energy" /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">Not set</SelectItem>{ENERGIES.map((energy) => <SelectItem key={energy} value={energy}>{energy}</SelectItem>)}</SelectContent>
              </Select>
              <FieldLabel>Context</FieldLabel>
              <div className="context-chips">
                {CONTEXTS.map((context) => <button key={context} type="button" className={contextValues.has(context) ? "selected" : ""} onClick={() => toggleContext(context)}>{context}</button>)}
              </div>
            </section>

            <section className="editor-section">
              <h3>Connect it</h3>
              <div className="field-grid">
                <div><FieldLabel>Area</FieldLabel><RelationSelect value={item.area} options={relations.areas} placeholder="Choose area" onChange={(value) => void save({ area: value })} /></div>
                <div><FieldLabel>Project</FieldLabel><RelationSelect value={item.project} options={relations.projects} placeholder="Choose project" onChange={(value) => void save({ project: value })} /></div>
                <div><FieldLabel>Goal</FieldLabel><RelationSelect value={item.goal} options={relations.goals} placeholder="Choose goal" onChange={(value) => void save({ goal: value })} /></div>
              </div>
            </section>

            <section className="editor-section">
              <h3>Details</h3>
              <FieldLabel>Notes</FieldLabel>
              <textarea
                className="notes-editor"
                defaultValue={item.originalNotes || ""}
                key={`${item.id}-notes`}
                rows={6}
                placeholder="Anything you need when you come back to this"
                onBlur={(event) => {
                  const value = event.currentTarget.value;
                  if (value !== (item.originalNotes || "")) void save({ originalNotes: value || null });
                }}
              />
              <div className="editor-actions">
                <button type="button" className="touch-button" onClick={() => void save({ lastInteraction: new Date().toISOString() })}><Sparkles />Mark active now</button>
                <label className="star-toggle"><Switch checked={item.starred} onCheckedChange={(checked) => void save({ starred: checked })} /><span>Starred</span></label>
              </div>
            </section>

            <div className="record-meta">
              <span>Attention {Math.round(item.attentionScore)}</span>
              <span>{Math.round(item.stalenessDays)} days stale</span>
              {item.lastInteraction && <span>Last active {new Date(item.lastInteraction).toLocaleString()}</span>}
              {item.todoistId && <a href={`https://app.todoist.com/app/task/${item.todoistId}`} target="_blank" rel="noreferrer">Open in Todoist <ExternalLink /></a>}
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <AlertDialog open={removeTodoist} onOpenChange={setRemoveTodoist}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this task from Todoist?</AlertDialogTitle>
            <AlertDialogDescription>The Notion item and Burner Board copy stay intact. Only the Todoist task is deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void save({ showInTodoist: false })}>Remove from Todoist</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ConnectionsSheet({
  open,
  data,
  onOpenChange,
  onRefresh,
  onExport,
}: {
  open: boolean;
  data: BoardPayload;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
  onExport: () => void;
}) {
  const [notionToken, setNotionToken] = useState("");
  const [todoistToken, setTodoistToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const connect = async (provider: "notion" | "todoist", token: string) => {
    setBusy(provider);
    try {
      await boardRequest({ action: "connect", provider, token });
      if (provider === "notion") setNotionToken("");
      else setTodoistToken("");
      toast.success(`${provider === "notion" ? "Notion" : "Todoist"} connected.`);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (provider: "notion" | "todoist") => {
    setBusy(provider);
    try {
      await boardRequest({ action: "disconnect", provider });
      toast.success("Connection removed. Your tasks were not deleted.");
      await onRefresh();
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    const id = toast.loading("Pulling the latest Notion changes...");
    try {
      const result = await boardRequest({ action: "sync_notion" });
      toast.success(`Pulled ${result.pulled} items from Notion.`, { id });
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Notion sync failed.", { id });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="connections-sheet sm:max-w-lg" side="right">
        <SheetHeader>
          <SheetTitle>Connections</SheetTitle>
          <SheetDescription>Your export is already loaded. Connect services when you want live write-back.</SheetDescription>
        </SheetHeader>
        <div className="connections-scroll">
          <div className="privacy-note"><CircleAlert /><p>The ChatGPT Notion connector cannot pass its login into a separate Site. These tokens are encrypted before this app stores them.</p></div>

          <section className="connection-card">
            <div className="connection-heading">
              <span className="notion-letter">N</span>
              <span><strong>Notion</strong><small>{data.connections.notion ? "Connected to All Items" : "Snapshot mode"}</small></span>
              <span className={data.connections.notion ? "status-live" : "status-off"}>{data.connections.notion ? "Live" : "Off"}</span>
            </div>
            {data.connections.notion ? (
              <div className="connection-actions">
                <Button onClick={() => void sync()} disabled={busy === "sync"}><RefreshCw className={busy === "sync" ? "animate-spin" : ""} />Sync now</Button>
                <Button variant="outline" onClick={() => void disconnect("notion")} disabled={busy === "notion"}>Disconnect</Button>
              </div>
            ) : (
              <div className="token-form">
                <ol>
                  <li>Create a Notion internal integration.</li>
                  <li>Share All Items, Areas, Projects, and Goals with it.</li>
                  <li>Paste its secret below.</li>
                </ol>
                <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">Open Notion integrations <ExternalLink /></a>
                <input type="password" value={notionToken} onChange={(event) => setNotionToken(event.target.value)} placeholder="ntn_..." autoComplete="off" />
                <Button onClick={() => void connect("notion", notionToken)} disabled={!notionToken || busy === "notion"}>{busy === "notion" && <Loader2 className="animate-spin" />}Connect Notion</Button>
              </div>
            )}
          </section>

          <section className="connection-card">
            <div className="connection-heading">
              <span className="todoist-letter">T</span>
              <span><strong>Todoist</strong><small>{data.connections.todoist ? "Ready for selected tasks" : "Nothing will be copied yet"}</small></span>
              <span className={data.connections.todoist ? "status-live" : "status-off"}>{data.connections.todoist ? "Live" : "Off"}</span>
            </div>
            {data.connections.todoist ? (
              <div className="connection-actions"><Button variant="outline" onClick={() => void disconnect("todoist")} disabled={busy === "todoist"}>Disconnect</Button></div>
            ) : (
              <div className="token-form">
                <p>Use your personal API token. Burner Board only creates tasks you mark &quot;Show in Todoist.&quot;</p>
                <a href="https://app.todoist.com/app/settings/integrations/developer" target="_blank" rel="noreferrer">Open Todoist developer settings <ExternalLink /></a>
                <input type="password" value={todoistToken} onChange={(event) => setTodoistToken(event.target.value)} placeholder="Todoist API token" autoComplete="off" />
                <Button onClick={() => void connect("todoist", todoistToken)} disabled={!todoistToken || busy === "todoist"}>{busy === "todoist" && <Loader2 className="animate-spin" />}Connect Todoist</Button>
              </div>
            )}
          </section>

          <section className="data-card">
            <div><strong>{data.importedCount} items loaded</strong><small>Grouped from your Notion export</small></div>
            <Button variant="outline" onClick={onExport}><Download />Export current CSV</Button>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function BoardApp({ displayName }: { displayName: string }) {
  const [data, setData] = useState<BoardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<BoardMode>("dashboard");
  const [search, setSearch] = useState("");
  const [view, setView] = useState("active");
  const [source, setSource] = useState("all");
  const [area, setArea] = useState("all");
  const [capture, setCapture] = useState("");
  const [capturing, setCapturing] = useState(false);

  const load = async () => {
    try {
      setError(null);
      setData(await boardRequest());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Your board could not load.");
    }
  };
  useEffect(() => {
    let active = true;
    void boardRequest()
      .then((payload) => { if (active) setData(payload); })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Your board could not load.");
      });
    return () => { active = false; };
  }, []);

  const selected = data?.items.find((item) => item.id === selectedId) || null;
  const openItems = data?.items.filter((item) => !["Done", "Archived"].includes(item.status)) || [];
  const completedItems = data?.items.filter((item) => item.status === "Done") || [];
  const stats = {
    active: openItems.length,
    unrated: openItems.filter(needsPriority).length,
    today: openItems.filter(isTodayItem).length,
    reminders: openItems.filter((item) => item.itemType === "Reminder").length,
    completed: completedItems.length,
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    const query = search.trim().toLowerCase();
    return data.items.filter((item) => {
      if (view === "active" && ["Done", "Archived"].includes(item.status)) return false;
      if (view === "unrated" && (["Done", "Archived"].includes(item.status) || !needsPriority(item))) return false;
      if (view === "no_due" && (["Done", "Archived"].includes(item.status) || item.priority === 0 || item.due || item.scheduledFor)) return false;
      if (view === "todoist" && !item.showInTodoist) return false;
      if (view === "starred" && !item.starred) return false;
      if (view === "due" && !item.due) return false;
      if (view === "done" && !["Done", "Archived"].includes(item.status)) return false;
      if (source !== "all" && item.source !== source) return false;
      if (area !== "all" && item.area !== area) return false;
      if (query && ![item.title, item.originalNotes, item.collection, item.area, item.project, item.goal].filter(Boolean).join(" ").toLowerCase().includes(query)) return false;
      return true;
    });
  }, [data, search, view, source, area]);

  const dashboard = useMemo(() => {
    const open = filtered.filter((item) => !["Done", "Archived"].includes(item.status));
    const today = open.filter(isTodayItem).sort(urgencySort);
    const week = open.filter(isThisWeekItem).sort(urgencySort);
    return {
      today,
      week,
      longer: open.filter((item) => !isTodayItem(item) && !isThisWeekItem(item) && item.itemType !== "Reminder" && item.priority !== null && item.priority > 0).sort(urgencySort),
      triage: open.filter(needsPriority).sort(attentionSort),
      reminders: open.filter((item) => item.itemType === "Reminder").sort(urgencySort),
      done: filtered.filter((item) => item.status === "Done").sort((a, b) => (b.completedAt || b.updatedAt).localeCompare(a.completedAt || a.updatedAt)),
      archived: filtered.filter((item) => item.status === "Archived").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }, [filtered]);

  const completedThisWeek = completedItems.filter((item) => {
    const date = inputDate(item.completedAt);
    if (!date) return false;
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return date >= localIso(weekAgo);
  }).length;
  const completedThisMonth = completedItems.filter((item) => inputDate(item.completedAt).startsWith(localIso().slice(0, 7))).length;

  const saveItem = async (id: string, changes: EditableChanges) => {
    if (!data) return;
    setData({ ...data, items: data.items.map((item) => item.id === id ? { ...item, ...changes, dirty: !data.connections.notion } : item) });
    try {
      const result = await boardRequest({ action: "update", id, changes });
      setData((current) => current ? {
        ...current,
        items: current.items.map((item) => item.id === id ? result.item : item),
        collections: result.item.collection && !current.collections.includes(result.item.collection)
          ? [...current.collections, result.item.collection].sort()
          : current.collections,
      } : current);
      if (result.sync?.message) toast.warning(result.sync.message);
      else if (result.sync?.notion === false) toast.warning("Saved here. Notion will need a retry.");
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "The change did not save.");
      await load();
    }
  };

  const create = async () => {
    const title = capture.trim();
    if (!title || !data) return;
    setCapturing(true);
    try {
      const result = await boardRequest({ action: "create", title });
      setData({ ...data, items: [result.item, ...data.items] });
      setCapture("");
      setSelectedId(result.item.id);
      toast.success(data.connections.notion ? "Added to Notion." : "Captured here. Give it a 0–10 rating when you are ready.");
    } catch (captureError) {
      toast.error(captureError instanceof Error ? captureError.message : "Capture failed.");
    } finally {
      setCapturing(false);
    }
  };

  const createList = async (name: string, type: string) => {
    if (!data) return;
    try {
      const result = await boardRequest({ action: "list_create", name, type });
      setData((current) => current ? { ...current, lists: [...current.lists, result.list].sort((a, b) => a.name.localeCompare(b.name)) } : current);
      toast.success(`Created "${name}".`);
    } catch (createError) {
      toast.error(createError instanceof Error ? createError.message : "The list could not be created.");
    }
  };

  const saveList = async (id: string, listChanges: EditableList) => {
    if (!data) return;
    try {
      const result = await boardRequest({ action: "list_update", id, listChanges });
      setData((current) => current ? { ...current, lists: current.lists.map((list) => list.id === id ? result.list : list) } : current);
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "The list did not save.");
    }
  };

  const deleteList = async (id: string) => {
    if (!data) return;
    const list = data.lists.find((entry) => entry.id === id);
    try {
      const result = await boardRequest({ action: "list_delete", id });
      setData((current) => current ? {
        ...current,
        lists: current.lists.filter((entry) => entry.id !== id),
        items: current.items.map((item) => item.collection === list?.name ? { ...item, collection: null } : item),
      } : current);
      toast.success(result.reassignedCount ? `Deleted. ${result.reassignedCount} task${result.reassignedCount === 1 ? "" : "s"} moved to no list.` : "List deleted.");
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : "The list could not be deleted.");
    }
  };

  const exportCsv = () => {
    if (!data) return;
    const keys: Array<keyof BoardItem> = ["title", "status", "collection", "priority", "itemType", "source", "due", "scheduledFor", "dateMode", "recurrence", "reminderTime", "energy", "context", "area", "project", "goal", "originalNotes", "lastInteraction", "completedAt", "starred", "showInTodoist", "todoistId", "id"];
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [keys.join(","), ...data.items.map((item) => keys.map((key) => quote(item[key])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `burner-board-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (error) return (
    <main className="fatal-state"><CircleAlert /><h1>Burner Board could not load</h1><p>{error}</p><Button onClick={() => void load()}>Try again</Button></main>
  );
  if (!data) return (
    <main className="loading-state"><div className="loading-flame"><Flame /></div><p>Loading your board</p></main>
  );

  const sources = [...new Set(data.items.map((item) => item.source).filter(Boolean) as string[])].sort();
  const allTags = [...new Set(data.items.flatMap((item) => tagList(item.tags)))].sort((a, b) => a.localeCompare(b));
  const collectionCount = new Set(filtered.filter((item) => item.collection || item.priority === 0).map((item) => item.collection || item.source || item.itemType)).size;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark"><Flame /></span>
          <span><strong>Burner Board</strong><small>{displayName.split(" ")[0]}’s task desk</small></span>
        </div>
        <div className="sync-cluster">
          <span className={data.connections.notion ? "sync-state live" : "sync-state snapshot"}><span />{data.connections.notion ? "Notion live" : "Snapshot"}</span>
          <button type="button" className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Open connections"><Settings2 /></button>
        </div>
      </header>

      <section className="command-deck">
        <div className="capture-box">
          <Plus />
          <input value={capture} onChange={(event) => setCapture(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} placeholder="Capture something before it disappears..." aria-label="Quick capture" />
          <button type="button" onClick={() => void create()} disabled={!capture.trim() || capturing}>{capturing ? <Loader2 className="animate-spin" /> : "Add"}</button>
        </div>
        <div className="stat-strip">
          <button type="button" onClick={() => { setMode("dashboard"); setView("active"); }}><span>{stats.today}</span>Today</button>
          <button type="button" className="needs-sort" onClick={() => { setMode("prioritize"); setView("active"); }}><span>{stats.unrated}</span>Prioritize</button>
          <button type="button" className="front-stat" onClick={() => { setMode("reminders"); setView("active"); }}><span>{stats.reminders}</span>Reminders</button>
          <button type="button" className="todoist-stat" onClick={() => { setMode("completed"); setView("all"); }}><span>{stats.completed}</span>Finished</button>
        </div>
      </section>

      <section className="view-switcher">
        <Tabs value={mode} onValueChange={(value) => {
          setMode(value as BoardMode);
          setView(value === "completed" ? "all" : "active");
        }}>
          <TabsList>
            <TabsTrigger value="dashboard"><CalendarClock />Plan</TabsTrigger>
            <TabsTrigger value="prioritize"><Gauge />Prioritize <span className="tab-count">{stats.unrated}</span></TabsTrigger>
            <TabsTrigger value="collections"><ListChecks />Lists + goals</TabsTrigger>
            <TabsTrigger value="reminders"><BellRing />Reminders</TabsTrigger>
            <TabsTrigger value="completed"><Trophy />Finished</TabsTrigger>
          </TabsList>
        </Tabs>
        <p>{mode === "dashboard"
          ? "Today, this week, then longer. Color shows what needs attention first."
          : mode === "prioritize"
            ? "Only uncategorized tasks without a priority appear here."
            : mode === "collections"
              ? `${collectionCount} original lists. Drag rows between groups or into a long-term subtable.`
              : mode === "reminders"
                ? "Recurring items live here. Notification delivery can connect to Apple Reminders or Google Calendar later."
                : "Completed tasks count toward your productivity history. Archived items stay recoverable."}</p>
      </section>

      <section className="filterbar">
        <div className="search-box"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks, lists, notes..." /></div>
        <Select value={view} onValueChange={(value) => {
          setView(value);
          if (value === "unrated") setMode("prioritize");
        }}>
          <SelectTrigger className="filter-select"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Open items</SelectItem>
            <SelectItem value="unrated">Needs priority</SelectItem>
            <SelectItem value="no_due">No due date</SelectItem>
            <SelectItem value="todoist">In Todoist</SelectItem>
            <SelectItem value="starred">Starred</SelectItem>
            <SelectItem value="due">Has due date</SelectItem>
            <SelectItem value="done">Done and archived</SelectItem>
            <SelectItem value="all">Everything</SelectItem>
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="filter-select"><SelectValue placeholder="All sources" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All sources</SelectItem>{sources.map((value) => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={area} onValueChange={setArea}>
          <SelectTrigger className="filter-select area-filter"><SelectValue placeholder="All areas" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All areas</SelectItem>{data.relations.areas.map((option) => <SelectItem value={option.value} key={option.id}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
        <span className="result-count">{filtered.length} shown</span>
      </section>

      {mode === "dashboard" ? (
        <section className="dashboard-wrap">
          <div className="dashboard-grid">
            <TaskTable
              allTags={allTags}
              collections={data.collections}
              empty="Nothing due or scheduled today"
              icon={CalendarClock}
              items={dashboard.today}
              note="Today and overdue. Automatically added to Todoist."
              onDrop={(id) => void saveItem(id, { scheduledFor: localIso(), showInTodoist: true })}
              onOpen={(item) => setSelectedId(item.id)}
              onSave={(id, changes) => void saveItem(id, changes)}
              title="Today"
            />
            <TaskTable
              allTags={allTags}
              collections={data.collections}
              empty="Nothing scheduled for the rest of this week"
              icon={Zap}
              items={dashboard.week}
              note={`Tomorrow through ${dueLabel(weekEndIso())}`}
              onDrop={(id) => void saveItem(id, { scheduledFor: weekEndIso() })}
              onOpen={(item) => setSelectedId(item.id)}
              onSave={(id, changes) => void saveItem(id, changes)}
              title="This week"
            />
            <TaskTable
              allTags={allTags}
              collections={data.collections}
              empty="No longer-range prioritized tasks match these filters"
              icon={History}
              items={dashboard.longer}
              note="After this week or no date. Highest attention first."
              onDrop={(id) => void saveItem(id, { due: null, scheduledFor: null, dateMode: "unspecified" })}
              onOpen={(item) => setSelectedId(item.id)}
              onSave={(id, changes) => void saveItem(id, changes)}
              title="Longer"
            />
          </div>
          <div className="heat-legend"><span>Attention color</span><i className="heat-low" />Low<i className="heat-mid" />Medium<i className="heat-high" />High</div>
        </section>
      ) : mode === "prioritize" ? (
        <section className="dashboard-wrap prioritize-wrap">
          <TaskTable
            allTags={allTags}
            collections={data.collections}
            empty="Everything uncategorized has a priority"
            icon={Gauge}
            items={dashboard.triage}
            note="No priority and no list, area, project, goal, or context"
            onDrop={(id) => void saveItem(id, { priority: null })}
            onOpen={(item) => setSelectedId(item.id)}
            onSave={(id, changes) => void saveItem(id, changes)}
            title="Needs a priority"
          />
        </section>
      ) : mode === "collections" ? (
        <section className="collections-wrap">
          <CollectionsView
            items={filtered}
            lists={data.lists}
            onCreateList={(name, type) => void createList(name, type)}
            onDeleteList={(id) => void deleteList(id)}
            onOpen={(item) => setSelectedId(item.id)}
            onPriority={(id, priority) => void saveItem(id, { priority })}
            onMove={(id, changes) => void saveItem(id, changes)}
            onSaveList={(id, changes) => void saveList(id, changes)}
            onStatus={(item) => void saveItem(item.id, { status: ["Done", "Archived"].includes(item.status) ? "Not started" : "Done" })}
          />
        </section>
      ) : mode === "reminders" ? (
        <section className="dashboard-wrap single-table-wrap">
          <div className="reminder-note"><BellRing /><span><strong>Reminder schedule</strong><small>Dates, times, and repeat rules are saved now. Apple Reminders or Google Calendar can handle notifications when that connection is added.</small></span></div>
          <TaskTable
            allTags={allTags}
            collections={data.collections}
            empty="No recurring reminders yet"
            icon={BellRing}
            items={dashboard.reminders}
            note="Edit the date, time, and repeat rule without leaving this list."
            onDrop={(id) => void saveItem(id, { itemType: "Reminder", priority: 0 })}
            onOpen={(item) => setSelectedId(item.id)}
            onSave={(id, changes) => void saveItem(id, changes)}
            title="Reminders"
          />
        </section>
      ) : (
        <section className="dashboard-wrap productivity-wrap">
          <div className="productivity-stats">
            <span><strong>{completedItems.length}</strong><small>Finished total</small></span>
            <span><strong>{completedThisWeek}</strong><small>Last 7 days</small></span>
            <span><strong>{completedThisMonth}</strong><small>This month</small></span>
          </div>
          <div className="productivity-grid">
            <TaskTable
              allTags={allTags}
              collections={data.collections}
              completed
              empty="Finished tasks will appear here"
              icon={Trophy}
              items={dashboard.done}
              note="Your productivity history"
              onOpen={(item) => setSelectedId(item.id)}
              onSave={(id, changes) => void saveItem(id, changes)}
              title="Finished"
            />
            <TaskTable
              allTags={allTags}
              collections={data.collections}
              empty="Nothing archived"
              icon={Archive}
              items={dashboard.archived}
              note="Removed from active views, but still recoverable"
              onOpen={(item) => setSelectedId(item.id)}
              onSave={(id, changes) => void saveItem(id, changes)}
              title="Archived"
            />
          </div>
        </section>
      )}

      <div className="mobile-hint"><ArrowUpDown />{mode === "collections" ? "Tap a row to edit. Use the circle to complete it." : "Hover for quick actions. Tap the title for every field."}</div>

      <EditorSheet
        collections={data.collections}
        connections={data.connections}
        item={selected}
        key={selected?.id || "none"}
        onNeedConnection={() => setSettingsOpen(true)}
        onOpenChange={(open) => { if (!open) setSelectedId(null); }}
        onSave={saveItem}
        open={Boolean(selectedId)}
        relations={data.relations}
      />
      <ConnectionsSheet open={settingsOpen} data={data} onOpenChange={setSettingsOpen} onRefresh={load} onExport={exportCsv} />
      <Toaster position="bottom-right" richColors />
    </main>
  );
}
