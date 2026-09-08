"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Archive,
  ArrowUpDown,
  BellRing,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
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
  GripVertical,
  Inbox,
  ListChecks,
  Loader2,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShoppingCart,
  Star,
  Target,
  Trash2,
  Trophy,
  Ungroup,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { ITEM_TYPES, LIST_TYPES, listTypeDefaults, type BoardItem, type BoardList, type BoardPayload, type EditableChanges, type EditableList, type HomeVisibility, type RelationOption } from "@/lib/board-types";

import OrganizeMode from "./organize-mode";
import "./organize.css";
import { HistoryView } from "@/components/board/history-view";
import { BulkActionBar } from "@/components/board/bulk-actions";
import { FocusView } from "@/components/board/focus-view";
import { PeriodProgress } from "@/components/board/period-progress";
import { WeeklyProgress } from "@/components/board/weekly-progress";
import { needsOrganization } from "@/lib/organizing";
import { sampleBoard } from "@/lib/sample-board";
import { belongsToList, compareListItems, LIST_RULES, LIST_SORTS, listMoveChanges, plannedDate, reorderedListIds } from "@/lib/list-behavior";

type BoardMode = "home" | "organize" | "calendar" | "goals" | "reminders" | "focus" | "completed";

const STATUSES = ["Not started", "In progress", "Done", "Archived"];
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
  const payload = await response.json() as BoardPayload & {
    item: BoardItem; list: BoardList; reassignedCount: number; pulled: number; error?: string;
    sync?: { notion: boolean | null; message?: string };
  };
  if (!response.ok) throw new Error(payload.error || "The board could not finish that change.");
  return payload;
}

/** Phase 3 slice 2 (+ Today/Month/Year extension): the new versioned command envelope
 * (roadmap section 7), used for the focus/week/period commands - see app/api/board/route.ts's
 * POST handler. Returns the refreshed focus/weekProgress/todayProgress/monthProgress/
 * yearProgress bundle so callers can update state without a full board reload. */
async function commandRequest(action: string, payload: unknown) {
  const response = await fetch("/api/board", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiVersion: 1, requestId: crypto.randomUUID(), action, payload }),
  });
  const body = await response.json() as {
    focus?: BoardPayload["focus"];
    weekProgress?: BoardPayload["weekProgress"];
    todayProgress?: BoardPayload["todayProgress"];
    monthProgress?: BoardPayload["monthProgress"];
    yearProgress?: BoardPayload["yearProgress"];
    error?: string;
  };
  if (!response.ok) throw new Error(body.error || "That action failed.");
  return body as {
    focus: BoardPayload["focus"];
    weekProgress: BoardPayload["weekProgress"];
    todayProgress: BoardPayload["todayProgress"];
    monthProgress: BoardPayload["monthProgress"];
    yearProgress: BoardPayload["yearProgress"];
  };
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
  date.setDate(date.getDate() + remaining);
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

const needsPriority = needsOrganization;

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

type GroupedItem = BoardItem & { groupMembers?: BoardItem[] };

// Groups collapse into one synthetic row for display: the anchor member's fields (title,
// itemType, collection, priority) represent the group, with due set to the earliest member
// date and attentionScore pre-baked to the max of members' effective attention — so every
// existing urgency/date function (effectiveAttention, isTodayItem, ...) keeps working
// unmodified on the collapsed row. Members ride along in groupMembers for the expanded view.
function collapseGroups(items: BoardItem[]): GroupedItem[] {
  const byAnchor = new Map<string, BoardItem[]>();
  const solo: GroupedItem[] = [];
  for (const item of items) {
    if (item.groupId) {
      const members = byAnchor.get(item.groupId) || [];
      members.push(item);
      byAnchor.set(item.groupId, members);
    } else {
      solo.push(item);
    }
  }
  const collapsed = [...solo];
  for (const [anchorId, members] of byAnchor) {
    const anchor = members.find((member) => member.id === anchorId) || members[0];
    const dates = members.map((member) => inputDate(member.due) || inputDate(member.scheduledFor)).filter(Boolean).sort();
    collapsed.push({
      ...anchor,
      due: dates[0] || null,
      scheduledFor: null,
      attentionScore: Math.max(...members.map((member) => effectiveAttention(member))),
      groupMembers: members,
    });
  }
  return collapsed;
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

/** Adam's feedback (docs/adr/local/time-horizon-quick-actions.md): Today/Week/Month/Year as
 * one-click quick actions, but as a single popover rather than four more standalone toolbar
 * pills - he's repeatedly flagged row-toolbar clutter (duplicate priority/list/complete
 * controls, dead Active/Archive buttons removed earlier this phase). Active horizons show as
 * small dots on the trigger itself, so membership is visible without opening it. */
function PlanPopover({ isToday, isThisWeek, isThisMonth, isThisYear, onToggleToday, onToggleWeek, onToggleMonth, onToggleYear }: {
  isToday?: boolean;
  isThisWeek?: boolean;
  isThisMonth?: boolean;
  isThisYear?: boolean;
  onToggleToday?: (committed: boolean) => void;
  onToggleWeek?: (committed: boolean) => void;
  onToggleMonth?: (committed: boolean) => void;
  onToggleYear?: (committed: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const rows: { label: string; active?: boolean; onToggle?: (committed: boolean) => void }[] = [
    { label: "Today", active: isToday, onToggle: onToggleToday },
    { label: "This week", active: isThisWeek, onToggle: onToggleWeek },
    { label: "This month", active: isThisMonth, onToggle: onToggleMonth },
    { label: "This year", active: isThisYear, onToggle: onToggleYear },
  ];
  const activeCount = rows.filter((row) => row.active).length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={activeCount ? "plan-action is-active" : "plan-action"} onClick={(event) => event.stopPropagation()}>
          <CalendarCheck />Plan{activeCount > 0 && <span className="plan-dots" aria-hidden="true">{rows.filter((row) => row.active).map((row) => <i key={row.label} />)}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="plan-popover" onClick={(event) => event.stopPropagation()}>
        {rows.map((row) => (
          <label key={row.label} className={row.onToggle ? "plan-row" : "plan-row is-disabled"}>
            <input type="checkbox" checked={Boolean(row.active)} disabled={!row.onToggle} onChange={(event) => row.onToggle?.(event.currentTarget.checked)} />
            {row.label}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function QuickEditor({ item, onSave }: {
  item: BoardItem;
  onSave: (id: string, changes: EditableChanges) => void;
}) {
  const commitText = (key: "title" | "originalNotes", value: string) => {
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
        {/* Adam's feedback: this used to also have a free-text "List" field here (with a
         * datalist autocomplete), duplicating the row's own "Move to list..." dropdown - removed,
         * that dropdown is the one functional path to change a task's list from the row now. */}
        <label className="quick-field"><span>Type</span><select value={item.itemType} onChange={(event) => onSave(item.id, { itemType: event.currentTarget.value, ...(!usesPriority(event.currentTarget.value) ? { priority: 0 } : {}) })}>{ITEM_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <label className="quick-field quick-details-field"><span>Details</span><input key={`${item.updatedAt}:notes`} defaultValue={item.originalNotes || ""} placeholder="Add a short note" onBlur={(event) => commitText("originalNotes", event.currentTarget.value)} /></label>
        {(item.itemType === "Reminder" || item.itemType === "Event") && <>
          <label className="quick-field"><span>Repeat</span><select value={item.recurrence || ""} onChange={(event) => onSave(item.id, { recurrence: event.currentTarget.value || null })}><option value="">Does not repeat</option>{RECURRENCES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="quick-field"><span>Time</span><input type="time" value={item.reminderTime || ""} onChange={(event) => onSave(item.id, { reminderTime: event.currentTarget.value || null })} /></label>
        </>}
        {usesPriority(item.itemType) && <div className="quick-priority"><PriorityControl item={item} key={`${item.id}:${item.priority ?? "unrated"}:quick`} onChange={(priority) => onSave(item.id, { priority })} /></div>}
      </div>
    </div>
  );
}

function TaskRow({ item, collections, completed = false, showPriority = true, groupMemberOf, selectable = false, selected = false, onToggleSelect, mergeCandidates, onOpen, onSave, onMergeInto, onUnlinkItem, onDisbandGroup, onDelete, isFocused, isThisWeek, isToday, isThisMonth, isThisYear, onToggleFocus, onToggleWeek, onToggleToday, onToggleMonth, onToggleYear }: {
  item: GroupedItem;
  collections: string[];
  completed?: boolean;
  showPriority?: boolean;
  groupMemberOf?: string;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  /** Phase 2: a keyboard/touch alternative to the shift+drag merge gesture. Other rows in the same table this one could group with (excludes itself). Omit to hide the control entirely. */
  mergeCandidates?: GroupedItem[];
  onOpen: (item: BoardItem) => void;
  onSave: (id: string, changes: EditableChanges) => void;
  onMergeInto?: (draggedId: string, targetId: string) => void;
  onUnlinkItem?: (id: string) => void;
  onDisbandGroup?: (anchorId: string) => void;
  onDelete?: (id: string) => void;
  /** Phase 3 slice 2 (quick-actions follow-up): the main workflow for Focus/weekly commitment is
   * these row-level toggles, not the Focus tab's own add-dropdowns (which stay as a secondary,
   * see-everything view). Omit both isFocused/onToggleFocus (or isThisWeek/onToggleWeek) to hide
   * the corresponding button entirely - used to keep these off Calendar/Goals/Reminders/History,
   * where they don't add value, without a mode flag threaded all the way down. */
  isFocused?: boolean;
  isThisWeek?: boolean;
  isToday?: boolean;
  isThisMonth?: boolean;
  isThisYear?: boolean;
  onToggleFocus?: (id: string, focused: boolean) => void;
  onToggleWeek?: (id: string, committed: boolean) => void;
  onToggleToday?: (id: string, committed: boolean) => void;
  onToggleMonth?: (id: string, committed: boolean) => void;
  onToggleYear?: (id: string, committed: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const done = ["Done", "Archived"].includes(item.status);
  const date = completed ? dueLabel(item.completedAt) : dueLabel(item.due || item.scheduledFor);
  const attention = Math.round(effectiveAttention(item));
  const members = item.groupMembers;
  const isGroup = Boolean(members && members.length > 1);
  return (
    <article
      className={`${done ? "dashboard-row is-done" : "dashboard-row"} ${item.dirty ? "is-dirty" : ""} ${dragOver ? "merge-target" : ""}`}
      draggable
      onDragStart={(event) => {
        event.stopPropagation();
        if ((event.target as HTMLElement).closest("button, input, select, .priority-control")) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.id);
      }}
      onDragOver={(event) => { if (onMergeInto && event.shiftKey && !event.dataTransfer.types.includes(LIST_DRAG_TYPE)) { event.preventDefault(); event.stopPropagation(); } }}
      onDragEnter={(event) => { if (onMergeInto && event.shiftKey && !event.dataTransfer.types.includes(LIST_DRAG_TYPE)) { event.stopPropagation(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        if (!onMergeInto || !event.shiftKey || event.dataTransfer.types.includes(LIST_DRAG_TYPE)) return;
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
        const draggedId = event.dataTransfer.getData("text/plain");
        if (draggedId && draggedId !== item.id) onMergeInto(draggedId, item.id);
      }}
      style={{ "--heat-color": heatColor(item) } as CSSProperties}
    >
      <div className="dashboard-row-main">
        {selectable && (
          <input
            type="checkbox"
            className="row-select-checkbox"
            aria-label={`Select ${item.title}`}
            checked={selected}
            onClick={(event) => event.stopPropagation()}
            onChange={() => onToggleSelect?.(item.id)}
          />
        )}
        {/* Adam's feedback: Focus had no persistent, always-visible indicator on the row itself -
         * only the hover-only toolbar button changed text. A focused-and-not-done item now shows
         * a star here instead of the plain empty circle, so it stands out in the list at a
         * glance without needing to hover. */}
        <button aria-label={done ? `Reopen ${item.title}` : `Complete ${item.title}`} className={isFocused && !done ? "check-button is-focus-star" : "check-button"} onClick={() => onSave(item.id, { status: done ? "Not started" : "Done" })} type="button">{done ? <CheckCircle2 /> : isFocused ? <Star /> : <span />}</button>
        <GripVertical className="dashboard-drag" aria-hidden="true" />
        <button className="dashboard-title" onClick={() => isGroup ? setExpanded((open) => !open) : onOpen(item)} type="button">
          <strong>{item.title}{isGroup && <em className="group-badge"><ChevronRight className={expanded ? "group-chevron open" : "group-chevron"} />{members!.length} tasks</em>}</strong>
          <span><i className={`source-dot ${sourceClass(item.source)}`} />{item.collection || shortRelation(item.area) || shortRelation(item.project) || item.itemType}</span>
        </button>
        <span className={date?.includes("overdue") ? "dashboard-due overdue" : "dashboard-due"}>{date || "—"}</span>
        {/* Adam's feedback: this tooltip used to describe attentionHeat() ("Combined urgency"),
         * a DIFFERENT number (priority folded in) than the one actually displayed here
         * (effectiveAttention, via `attention` above) - fixed to describe the real displayed
         * value and spell out why it's unrelated to Importance (staleness/last-interaction,
         * imported from Notion; this app never computes it locally - a brand-new task reads 0
         * regardless of its priority until Notion recomputes and a later sync pulls that in). */}
        <span className="heat-score" title={`Attention ${attention} - staleness/last-interaction, imported from Notion. Separate from Importance (${item.priority ?? "unrated"}) - a new task starts at 0 regardless of priority.`}><i />{attention}</span>
        {showPriority && usesPriority(item.itemType) ? (
          // Adam's feedback: this used to also render a compact <PriorityControl> slider here,
          // duplicating the one in QuickEditor below (visible on the same hover/expand) - one
          // slider per item now; this badge is just an at-a-glance readout, not an editor.
          <span className={item.priority === null ? "row-score unrated" : item.priority === 0 ? "row-score zero" : "row-score"} title="Importance - edit below">{item.priority === null ? "—" : item.priority}</span>
        ) : <span className="non-priority-type">{item.itemType}</span>}
        <button className="row-open" onClick={() => onOpen(item)} type="button" aria-label={`Open all details for ${item.title}`}><ChevronRight /></button>
      </div>
      <div className="quick-toolbar" aria-label={`Quick actions for ${item.title}`}>
        {/* Adam's feedback: this used to also have a "Done"/"Reopen" button here, doing the
         * exact same thing as the always-visible check-button to the left of the title -
         * removed, one complete/reopen control per row now. */}
        {!done && onToggleFocus && (
          <button type="button" className={isFocused ? "focus-action is-active" : "focus-action"} onClick={() => onToggleFocus(item.id, !isFocused)} aria-pressed={Boolean(isFocused)}>
            <Star fill={isFocused ? "currentColor" : "none"} />{isFocused ? "In Focus" : "Focus"}
          </button>
        )}
        {!done && (onToggleWeek || onToggleToday || onToggleMonth || onToggleYear) && (
          <PlanPopover
            isToday={isToday}
            isThisWeek={isThisWeek}
            isThisMonth={isThisMonth}
            isThisYear={isThisYear}
            onToggleToday={onToggleToday && ((committed) => onToggleToday(item.id, committed))}
            onToggleWeek={onToggleWeek && ((committed) => onToggleWeek(item.id, committed))}
            onToggleMonth={onToggleMonth && ((committed) => onToggleMonth(item.id, committed))}
            onToggleYear={onToggleYear && ((committed) => onToggleYear(item.id, committed))}
          />
        )}
        {/* Adam's feedback: "Active" (bumped lastInteraction with no other change) removed - it
         * had no observable effect worth a dedicated button: updateItem() already sets
         * lastInteraction on every single edit that doesn't explicitly override it, so this
         * button never did anything a normal edit wasn't already doing. */}
        <DateQuickPopover item={item} onSave={onSave} />
        <label className="move-list-control">
          <span className="sr-only">Move {item.title} to list</span>
          <select aria-label={`Move ${item.title} to list`} value="" onChange={(event) => { if (event.currentTarget.value) onSave(item.id, { collection: event.currentTarget.value === "__unfiled__" ? null : event.currentTarget.value }); }}>
            <option value="" disabled>Move to list…</option>
            <option value="__unfiled__">No list / Inbox</option>
            {collections.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        {!!mergeCandidates?.length && onMergeInto && (
          <label className="move-list-control">
            <span className="sr-only">Group {item.title} with another task</span>
            <select aria-label={`Group ${item.title} with another task`} value="" onChange={(event) => { if (event.currentTarget.value) onMergeInto(item.id, event.currentTarget.value); }}>
              <option value="" disabled>Group with…</option>
              {mergeCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
            </select>
          </label>
        )}
        {groupMemberOf && onUnlinkItem ? (
          <button type="button" onClick={() => onUnlinkItem(item.id)}><Ungroup />Unlink</button>
        ) : isGroup && onDisbandGroup ? (
          <button type="button" onClick={() => onDisbandGroup(item.id)}><Ungroup />Disband</button>
        ) : null}
        {/* Adam's feedback: "Archive" as a quick-toolbar button removed - not a control he found
         * useful for a quick row action. Archiving stays reachable through the full editor's
         * Status field (EditorSheet already lists "Archived" in STATUSES); nothing about the
         * Archived status itself, or History's separate Archived filter, changed. */}
        {onDelete && (confirmDelete ? (
          <span className="delete-confirm-inline">
            <span>Delete for good?</span>
            <button type="button" className="danger" onClick={() => onDelete(item.id)}>Delete</button>
            <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className="delete-action" onClick={() => setConfirmDelete(true)}><Trash2 />Delete</button>
        ))}
      </div>
      {!isGroup && <QuickEditor item={item} onSave={onSave} />}
      {isGroup && expanded && (
        <div className="group-members">
          {members!.map((member) => (
            <TaskRow
              collections={collections}
              completed={completed}
              groupMemberOf={item.id}
              item={member}
              showPriority={showPriority}
              key={member.id}
              onOpen={onOpen}
              onSave={onSave}
              onUnlinkItem={onUnlinkItem}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </article>
  );
}

export function TaskTable({ title, note, items, icon: Icon, empty, collections, completed = false, onOpen, onSave, onDrop, onMergeInto, onUnlinkItem, onDisbandGroup, onDelete, onBulkSave, focusedIds, weekCommittedIds, todayIds, monthIds, yearIds, onToggleFocus, onToggleWeek, onToggleToday, onToggleMonth, onToggleYear }: {
  title: string;
  note: string;
  items: GroupedItem[];
  icon: typeof Flame;
  empty: string;
  collections: string[];
  completed?: boolean;
  onOpen: (item: BoardItem) => void;
  onSave: (id: string, changes: EditableChanges) => void;
  onDrop?: (id: string) => void;
  onMergeInto?: (draggedId: string, targetId: string) => void;
  onUnlinkItem?: (id: string) => void;
  onDisbandGroup?: (anchorId: string) => void;
  onDelete?: (id: string) => void;
  /** Optional: when provided, a "Select" toggle and bulk move/type/importance actions become available. Omit to keep a table read-only-for-selection (e.g. inside an expanded group). */
  onBulkSave?: (ids: string[], changes: EditableChanges) => Promise<{ applied: number; failed: number }>;
  /** Phase 3 slice 2 (quick-actions follow-up): see TaskRow's doc comment - omit all to hide the row-level Focus/Plan quick-toggle controls entirely (used outside the Home page). */
  focusedIds?: Set<string>;
  weekCommittedIds?: Set<string>;
  todayIds?: Set<string>;
  monthIds?: Set<string>;
  yearIds?: Set<string>;
  onToggleFocus?: (id: string, focused: boolean) => void;
  onToggleWeek?: (id: string, committed: boolean) => void;
  onToggleToday?: (id: string, committed: boolean) => void;
  onToggleMonth?: (id: string, committed: boolean) => void;
  onToggleYear?: (id: string, committed: boolean) => void;
}) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allVisibleSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));
  const exitSelectionMode = () => { setSelectionMode(false); setSelectedIds(new Set()); };

  return (
    <section className="task-table-panel" onDragOver={(event) => { if (onDrop) event.preventDefault(); }} onDrop={(event) => { if (!onDrop) return; event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); if (id) onDrop(id); }}>
      <header className="task-table-head">
        <span className="task-table-icon"><Icon /></span>
        <span><h2>{title}</h2><p>{note}</p></span>
        {(() => {
          const focusedCount = focusedIds ? items.filter((item) => focusedIds.has(item.id)).length : 0;
          return focusedCount > 0 && <span className="focus-count"><Star fill="currentColor" /> {focusedCount} focused</span>;
        })()}
        {(() => {
          const todayCount = todayIds ? items.filter((item) => todayIds.has(item.id)).length : 0;
          return todayCount > 0 && <span className="focus-count period-count">{todayCount} today</span>;
        })()}
        {(() => {
          const monthCount = monthIds ? items.filter((item) => monthIds.has(item.id)).length : 0;
          return monthCount > 0 && <span className="focus-count period-count">{monthCount} this month</span>;
        })()}
        {(() => {
          const yearCount = yearIds ? items.filter((item) => yearIds.has(item.id)).length : 0;
          return yearCount > 0 && <span className="focus-count period-count">{yearCount} this year</span>;
        })()}
        <span className="task-table-count">{items.length}</span>
        {onBulkSave && !!items.length && (
          selectionMode ? (
            <button type="button" className="task-table-select-toggle" onClick={exitSelectionMode}>Done selecting</button>
          ) : (
            <button type="button" className="task-table-select-toggle" onClick={() => setSelectionMode(true)}>Select</button>
          )
        )}
      </header>
      {selectionMode && (
        <div className="task-table-select-all">
          <label>
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={() => setSelectedIds(allVisibleSelected ? new Set() : new Set(items.map((item) => item.id)))}
            />
            Select all visible ({items.length})
          </label>
        </div>
      )}
      {onBulkSave && selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          collections={collections}
          onClear={() => setSelectedIds(new Set())}
          onApply={(changes) => onBulkSave([...selectedIds], changes)}
        />
      )}
      <div className="task-table-columns" aria-hidden="true"><span>Task</span><span>{completed ? "Finished" : "Due"}</span><span>Attention</span><span>Priority</span><span /></div>
      <div className="task-table-body">
        {items.map((item) => (
          <TaskRow
            completed={completed}
            item={item}
            collections={collections}
            key={item.id}
            onDisbandGroup={onDisbandGroup}
            onMergeInto={onMergeInto}
            onOpen={onOpen}
            onSave={onSave}
            onUnlinkItem={onUnlinkItem}
            onDelete={onDelete}
            selectable={selectionMode}
            selected={selectedIds.has(item.id)}
            onToggleSelect={toggleSelect}
            isFocused={focusedIds?.has(item.id)}
            isThisWeek={weekCommittedIds?.has(item.id)}
            isToday={todayIds?.has(item.id)}
            isThisMonth={monthIds?.has(item.id)}
            isThisYear={yearIds?.has(item.id)}
            onToggleFocus={onToggleFocus}
            onToggleWeek={onToggleWeek}
            onToggleToday={onToggleToday}
            onToggleMonth={onToggleMonth}
            onToggleYear={onToggleYear}
          />
        ))}
        {!items.length && <div className="task-table-empty"><Check /><span>{empty}</span></div>}
      </div>
    </section>
  );
}

function ListManagePopover({ list, itemCount, hiddenCounts, visibility, onSave, onDelete, onMoveUp, onMoveDown }: {
  list: BoardList;
  itemCount: number;
  hiddenCounts: { goals: number; purchases: number };
  visibility: HomeVisibility;
  onSave: (id: string, changes: EditableList) => void;
  onDelete: (id: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const typeDefaults = listTypeDefaults(list.type);
  const priorityMode = list.showPriority === null ? "default" : list.showPriority ? "on" : "off";
  const goalsMode = list.showLongTermGoals === null || list.showLongTermGoals === undefined ? "default" : list.showLongTermGoals ? "on" : "off";
  const purchasesMode = list.showPurchases === null || list.showPurchases === undefined ? "default" : list.showPurchases ? "on" : "off";
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
          <span>Home page</span>
          <select value={list.pinned ? "pinned" : "other"} onChange={(event) => onSave(list.id, { pinned: event.currentTarget.value === "pinned" })}>
            <option value="pinned">Pinned at the top</option>
            <option value="other">Other lists</option>
          </select>
        </label>
        <div className="list-position-controls">
          <button type="button" disabled={!onMoveUp} onClick={onMoveUp}>Move up</button>
          <button type="button" disabled={!onMoveDown} onClick={onMoveDown}>Move down</button>
        </div>
        <label className="quick-field">
          <span>Tasks shown</span>
          <select value={list.rule || "manual"} onChange={(event) => onSave(list.id, { rule: event.currentTarget.value as BoardList["rule"] })}>
            {LIST_RULES.map(rule => <option key={rule.value} value={rule.value}>{rule.label}</option>)}
          </select>
        </label>
        <label className="quick-field">
          <span>Sort tasks</span>
          <select value={list.itemSort || "priority"} onChange={(event) => onSave(list.id, { itemSort: event.currentTarget.value as BoardList["itemSort"] })}>
            {LIST_SORTS.map(sort => <option key={sort.value} value={sort.value}>{sort.label}</option>)}
          </select>
        </label>
        <label className="quick-field">
          <span>List type</span>
          <select value={list.type} onChange={(event) => onSave(list.id, { type: event.currentTarget.value as BoardList["type"] })}>
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
        <div className="list-toggle-row">
          <span>Long-term goals in this list{hiddenCounts.goals > 0 && <em className="hidden-count"> · {hiddenCounts.goals} hidden</em>}</span>
          <div className="tri-toggle">
            <button type="button" className={goalsMode === "default" ? "selected" : ""} onClick={() => onSave(list.id, { showLongTermGoals: null })}>Default ({(typeDefaults.showLongTermGoals && visibility.goals) ? "on" : "off"})</button>
            <button type="button" className={goalsMode === "on" ? "selected" : ""} onClick={() => onSave(list.id, { showLongTermGoals: true })}>On</button>
            <button type="button" className={goalsMode === "off" ? "selected" : ""} onClick={() => onSave(list.id, { showLongTermGoals: false })}>Off</button>
          </div>
        </div>
        <div className="list-toggle-row">
          <span>Purchases in this list{hiddenCounts.purchases > 0 && <em className="hidden-count"> · {hiddenCounts.purchases} hidden</em>}</span>
          <div className="tri-toggle">
            <button type="button" className={purchasesMode === "default" ? "selected" : ""} onClick={() => onSave(list.id, { showPurchases: null })}>Default ({visibility.purchases ? "on" : "off"})</button>
            <button type="button" className={purchasesMode === "on" ? "selected" : ""} onClick={() => onSave(list.id, { showPurchases: true })}>On</button>
            <button type="button" className={purchasesMode === "off" ? "selected" : ""} onClick={() => onSave(list.id, { showPurchases: false })}>Off</button>
          </div>
        </div>
        {typeDefaults.hasReminderDefault && (
          <label className="quick-field">
            <span>Default reminder</span>
            <input key={`${list.id}:reminder`} defaultValue={list.reminderDefault || ""} placeholder="e.g. Monthly on the 1st" onBlur={(event) => { const value = event.currentTarget.value.trim(); if (value !== (list.reminderDefault || "")) onSave(list.id, { reminderDefault: value || null }); }} />
          </label>
        )}
        <label className="quick-field">
          <span>New items in this list default to</span>
          <select value={list.defaultItemType || ""} onChange={(event) => onSave(list.id, { defaultItemType: event.currentTarget.value || null })}>
            <option value="">No default (leave as-is)</option>
            {ITEM_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        {confirmDelete ? (
          <div className="list-delete-confirm">
            <p>{itemCount ? `${itemCount} assigned task${itemCount === 1 ? "" : "s"} will move to no list. Their dates and details are kept.` : "No tasks are assigned to this list."} Automatic matches keep their own lists.</p>
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
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Phase 2 (docs/plans/burner-board-roadmap.md, domain rule 5): new Lists are plain
    // containers - no Type choice up front. Existing Lists keep whatever type they already
    // have; List Type itself is still an open question (ADR 0003 topic 1), not retired here.
    // Change it later from a list's own Manage popover if it matters for that list.
    onCreate(trimmed, "general");
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
        <button type="button" disabled={!name.trim()} onClick={submit}>Create list</button>
      </div>
    </section>
  );
}

function UpcomingWidget({ items, position, onOpen, onMove }: {
  items: BoardItem[];
  position: "top" | "bottom";
  onOpen: (item: BoardItem) => void;
  onMove: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem("burner-upcoming-collapsed") === "1"); } catch { /* per-viewer only */ }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem("burner-upcoming-collapsed", next ? "1" : "0"); } catch { /* per-viewer only */ }
      return next;
    });
  };
  const upcoming = items
    .filter((item) => item.itemType !== "Event" && (item.due || item.scheduledFor))
    .sort((a, b) => (plannedDate(a) || "9999").localeCompare(plannedDate(b) || "9999"))
    .slice(0, 12);
  return (
    <section className={collapsed ? "upcoming-widget is-collapsed" : "upcoming-widget"}>
      <header className="upcoming-widget-head">
        <button type="button" className="upcoming-widget-toggle" aria-expanded={!collapsed} onClick={toggleCollapsed}>
          <CalendarDays />
          <span><h2>Upcoming due dates</h2><p>{upcoming.length} scheduled</p></span>
          <ChevronRight className={collapsed ? "collection-chevron" : "collection-chevron open"} />
        </button>
        <button type="button" className="upcoming-widget-move" title={position === "top" ? "Move to bottom of Home" : "Move to top of Home"} onClick={onMove}>
          <GripVertical />{position === "top" ? "Move down" : "Move up"}
        </button>
      </header>
      {!collapsed && (
        <div className="upcoming-widget-body">
          {!upcoming.length && <p className="upcoming-widget-empty">Nothing scheduled. Set a due or scheduled date on a task to see it here.</p>}
          {upcoming.map((item) => {
            const label = dueLabel(item.due || item.scheduledFor);
            return (
              <button key={item.id} type="button" className="upcoming-row" onClick={() => onOpen(item)}>
                <span className={label?.includes("overdue") ? "upcoming-date overdue" : "upcoming-date"}>{label}</span>
                <span className="upcoming-title">{item.title}</span>
                <span className="upcoming-collection">{item.collection || "No list"}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

const LIST_DRAG_TYPE = "application/x-burner-list-id";

function CollectionsView({
  items, allItems, lists, visibility, onOpen, onSaveItem, onCreateList, onSaveList,
  onDeleteList, onReorderLists, onMergeInto, onUnlinkItem, onDisbandGroup, onDeleteItem, onSaveVisibility, onBulkSave,
  focusedIds, weekCommittedIds, todayIds, monthIds, yearIds, onToggleFocus, onToggleWeek, onToggleToday, onToggleMonth, onToggleYear,
}: {
  items: BoardItem[];
  allItems: BoardItem[];
  lists: BoardList[];
  visibility: HomeVisibility;
  onOpen: (item: BoardItem) => void;
  onSaveItem: (id: string, changes: EditableChanges) => void;
  onCreateList: (name: string, type: string) => void;
  onSaveList: (id: string, changes: EditableList) => void;
  onDeleteList: (id: string) => void;
  onReorderLists: (orderedIds: string[], pin?: { id: string; pinned: boolean }) => void;
  onMergeInto: (draggedId: string, targetId: string) => void;
  onUnlinkItem: (id: string) => void;
  onDisbandGroup: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onSaveVisibility: (changes: Partial<HomeVisibility>) => void;
  onBulkSave: (ids: string[], changes: EditableChanges) => Promise<{ applied: number; failed: number }>;
  /** Phase 3 slice 2 (quick-actions follow-up): see TaskRow's doc comment. */
  focusedIds?: Set<string>;
  weekCommittedIds?: Set<string>;
  todayIds?: Set<string>;
  monthIds?: Set<string>;
  yearIds?: Set<string>;
  onToggleFocus?: (id: string, focused: boolean) => void;
  onToggleWeek?: (id: string, committed: boolean) => void;
  onToggleToday?: (id: string, committed: boolean) => void;
  onToggleMonth?: (id: string, committed: boolean) => void;
  onToggleYear?: (id: string, committed: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Phase 2: selection is lifted here (not per-list local state) because renderList below is a
  // plain closure invoked once per list inside .map() - it isn't its own component, so it can't
  // hold hooks of its own. Only one list can be "in selection mode" at a time, which also keeps
  // the UI simple: selecting across multiple lists at once isn't something this slice supports.
  const [selectionListId, setSelectionListId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const exitSelection = () => { setSelectionListId(null); setSelectedIds(new Set()); };
  const ordered = [...lists].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const names = lists.map(list => list.name);
  const moveList = (draggedId: string, target: BoardList) => {
    const dragged = lists.find(list => list.id === draggedId);
    if (!dragged || dragged.id === target.id) return;
    onReorderLists(reorderedListIds(lists, draggedId, target.id), { id: dragged.id, pinned: Boolean(target.pinned) });
  };
  const renderList = (list: BoardList, siblings: BoardList[]) => {
    const matchesAll = items.filter(item => belongsToList(item, list, lists));
    const typeDefaults = listTypeDefaults(list.type);
    const showGoals = list.showLongTermGoals ?? (typeDefaults.showLongTermGoals && visibility.goals);
    const showPurchases = list.showPurchases ?? visibility.purchases;
    const hiddenGoals = showGoals ? 0 : matchesAll.filter(item => item.itemType === "Goal").length;
    const hiddenPurchases = showPurchases ? 0 : matchesAll.filter(item => item.itemType === "Purchase").length;
    const matches = matchesAll.filter(item => (showGoals || item.itemType !== "Goal") && (showPurchases || item.itemType !== "Purchase"));
    const rows = collapseGroups(matches).sort((a, b) => compareListItems(a, b, list.itemSort, effectiveAttention));
    const assignedCount = allItems.filter(item => item.collection === list.name).length;
    const openCount = matches.filter(item => !["Done", "Archived"].includes(item.status)).length;
    // Adam's feedback: no way to see, at the list level, how many of a list's tasks are
    // currently in Focus - added alongside the existing open/shown/hidden counts.
    const focusedCount = focusedIds ? matches.filter(item => focusedIds.has(item.id)).length : 0;
    const todayCount = todayIds ? matches.filter(item => todayIds.has(item.id)).length : 0;
    const monthCount = monthIds ? matches.filter(item => monthIds.has(item.id)).length : 0;
    const yearCount = yearIds ? matches.filter(item => yearIds.has(item.id)).length : 0;
    const isExpanded = expanded[list.id] ?? Boolean(list.pinned);
    const Icon = list.rule === "inbox" ? Inbox : collectionIcon(list.name);
    const index = siblings.findIndex(entry => entry.id === list.id);
    const showPriority = list.showPriority ?? typeDefaults.showPriority;
    const isSelecting = selectionListId === list.id;
    const allRowsSelected = rows.length > 0 && rows.every(row => selectedIds.has(row.id));
    return (
      <section
        key={list.id}
        id={"home-list-" + list.id}
        data-list-id={list.id}
        aria-label={list.name + " list"}
        className={"collection-card unified-list " + (isExpanded ? "is-expanded " : "") + (dropTarget === list.id ? "is-drop-target" : "")}
        onDragOver={event => {
          if (!event.dataTransfer.types.includes("text/plain") && !event.dataTransfer.types.includes(LIST_DRAG_TYPE)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropTarget(list.id);
        }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null); }}
        onDrop={event => {
          event.preventDefault();
          event.stopPropagation();
          setDropTarget(null);
          const draggedList = event.dataTransfer.getData(LIST_DRAG_TYPE);
          if (draggedList) { moveList(draggedList, list); return; }
          const id = event.dataTransfer.getData("text/plain");
          if (allItems.some(item => item.id === id)) {
            onSaveItem(id, { collection: list.name });
            setExpanded(current => ({ ...current, [list.id]: true }));
          }
        }}
      >
        <header className="collection-head">
          <button
            className="list-drag-handle" type="button" draggable
            aria-label={"Drag to reorder " + list.name}
            title="Drag to reorder; use Manage for Move up or Move down"
            onDragStart={event => {
              event.stopPropagation();
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(LIST_DRAG_TYPE, list.id);
            }}
            onDragEnd={() => setDropTarget(null)}
          ><GripVertical /></button>
          <button className="collection-head-toggle" type="button" aria-expanded={isExpanded}
            onClick={() => setExpanded(current => ({ ...current, [list.id]: !isExpanded }))}>
            <span className="collection-icon"><Icon /></span>
            <span><h2>{list.name}</h2><p>{openCount} open · {matches.length} shown
              {focusedCount > 0 && <em className="focus-count"><Star fill="currentColor" /> {focusedCount} focused</em>}
              {todayCount > 0 && <em className="focus-count period-count">{todayCount} today</em>}
              {monthCount > 0 && <em className="focus-count period-count">{monthCount} this month</em>}
              {yearCount > 0 && <em className="focus-count period-count">{yearCount} this year</em>}
              {(hiddenGoals > 0 || hiddenPurchases > 0) && <em className="hidden-count">
                {hiddenGoals > 0 && ` · ${hiddenGoals} goal${hiddenGoals === 1 ? "" : "s"} hidden`}
                {hiddenPurchases > 0 && ` · ${hiddenPurchases} purchase${hiddenPurchases === 1 ? "" : "s"} hidden`}
              </em>}
            </p></span>
            <ChevronRight className={isExpanded ? "collection-chevron open" : "collection-chevron"} />
          </button>
          <button className={"list-pin " + (list.pinned ? "is-pinned" : "")} type="button"
            aria-label={(list.pinned ? "Unpin " : "Pin ") + list.name} aria-pressed={Boolean(list.pinned)}
            onClick={() => onSaveList(list.id, { pinned: !list.pinned })}><Pin /></button>
          {!!rows.length && (
            isSelecting ? (
              <button type="button" className="list-select-toggle" onClick={exitSelection}>Done</button>
            ) : (
              <button type="button" className="list-select-toggle" onClick={() => { setSelectionListId(list.id); setSelectedIds(new Set()); }}>Select</button>
            )
          )}
          <ListManagePopover list={list} itemCount={assignedCount} hiddenCounts={{ goals: hiddenGoals, purchases: hiddenPurchases }} visibility={visibility} onSave={onSaveList} onDelete={onDeleteList}
            onMoveUp={index > 0 ? () => moveList(list.id, siblings[index - 1]) : undefined}
            onMoveDown={index < siblings.length - 1 ? () => moveList(list.id, siblings[index + 1]) : undefined} />
        </header>
        {isExpanded && <>
          <div className="list-rule-note">
            <span>{LIST_RULES.find(rule => rule.value === (list.rule || "manual"))?.note}</span>
            <span>{LIST_SORTS.find(sort => sort.value === (list.itemSort || "priority"))?.label}</span>
          </div>
          {isSelecting && !!rows.length && (
            <div className="task-table-select-all">
              <label>
                <input type="checkbox" checked={allRowsSelected} onChange={() => setSelectedIds(allRowsSelected ? new Set() : new Set(rows.map(row => row.id)))} />
                Select all visible ({rows.length})
              </label>
            </div>
          )}
          {isSelecting && selectedIds.size > 0 && (
            <BulkActionBar
              count={selectedIds.size}
              collections={names}
              onClear={() => setSelectedIds(new Set())}
              onApply={(changes) => onBulkSave([...selectedIds], changes)}
            />
          )}
          <div className="collection-table">
            {rows.map(item => <TaskRow key={item.id} item={item} collections={names}
              showPriority={showPriority} onOpen={onOpen} onSave={onSaveItem}
              onMergeInto={onMergeInto} onUnlinkItem={onUnlinkItem} onDisbandGroup={onDisbandGroup} onDelete={onDeleteItem}
              selectable={isSelecting} selected={selectedIds.has(item.id)} onToggleSelect={toggleSelect}
              mergeCandidates={rows.filter(candidate => candidate.id !== item.id)}
              isFocused={focusedIds?.has(item.id)} isThisWeek={weekCommittedIds?.has(item.id)}
              isToday={todayIds?.has(item.id)} isThisMonth={monthIds?.has(item.id)} isThisYear={yearIds?.has(item.id)}
              onToggleFocus={onToggleFocus} onToggleWeek={onToggleWeek}
              onToggleToday={onToggleToday} onToggleMonth={onToggleMonth} onToggleYear={onToggleYear} />)}
            {!rows.length && <div className="subtable-empty">Drop a task here or choose this list from a task’s Move to list menu.</div>}
          </div>
        </>}
      </section>
    );
  };
  return (
    <div className="home-lists">
      <header className="lists-section-head">
        <ListChecks /><h2>Lists</h2><small>Pinned lists stay open at the top. Drag tasks between lists, and hold Shift while dropping on a task to group them.</small>
        <div className="visibility-toggle-row">
          <label><input type="checkbox" checked={visibility.goals} onChange={(event) => onSaveVisibility({ goals: event.currentTarget.checked })} />Show long-term goals in lists</label>
          <label><input type="checkbox" checked={visibility.purchases} onChange={(event) => onSaveVisibility({ purchases: event.currentTarget.checked })} />Show purchases in lists</label>
        </div>
      </header>
      <div className="collections-grid">
        <NewListCard onCreate={onCreateList} />
        {ordered.map(list => renderList(list, ordered))}
      </div>
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
  onOpenChange,
  onSave,
}: {
  item: BoardItem | null;
  open: boolean;
  relations: BoardPayload["relations"];
  collections: string[];
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, changes: EditableChanges) => Promise<unknown>;
}) {
  // Phase 2 (docs/plans/burner-board-roadmap.md): "Simplify the editor... reveal advanced
  // fields on demand." Collapsed by default every time a different item is opened (this
  // component remounts per item via its call site's key={selected?.id}), which is the
  // intended behavior, not a bug - hiding a field never touches its underlying value either
  // way, since React just doesn't render that section.
  const [moreOpen, setMoreOpen] = useState(false);
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

  return (
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
                <div><FieldLabel>Due</FieldLabel><input className="field-control" type="date" value={inputDate(item.due)} onChange={(event) => void save({ due: event.target.value || null })} /></div>
              </div>
            </section>

            <section className="editor-section">
              <h3>Notes</h3>
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
            </section>

            <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
              <CollapsibleTrigger className="editor-more-toggle" type="button">
                {moreOpen ? "Fewer fields" : "More fields"}<span>{moreOpen ? "−" : "+"}</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <section className="editor-section">
                  <h3>Type &amp; schedule</h3>
                  <div className="field-grid two">
                    <div>
                      <FieldLabel>Item type</FieldLabel>
                      <Select value={item.itemType} onValueChange={(value) => void save({ itemType: value })}>
                        <SelectTrigger className="field-control"><SelectValue /></SelectTrigger>
                        <SelectContent>{ITEM_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><FieldLabel>Scheduled</FieldLabel><input className="field-control" type="date" value={inputDate(item.scheduledFor)} onChange={(event) => void save({ scheduledFor: event.target.value || null })} /></div>
                    <div>
                      <FieldLabel>Date rule</FieldLabel>
                      <Select value={item.dateMode || (item.due ? "date_set" : "unspecified")} onValueChange={(value) => void save({ dateMode: value, ...(value === "no_date" ? { due: null, scheduledFor: null } : {}) })}>
                        <SelectTrigger className="field-control"><SelectValue /></SelectTrigger>
                        <SelectContent>{DATE_MODES.map((mode) => <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    {(item.itemType === "Reminder" || item.itemType === "Event") && <>
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
                  <label className="star-toggle"><Switch checked={item.starred} onCheckedChange={(checked) => void save({ starred: checked })} /><span>Starred</span></label>
                </section>
              </CollapsibleContent>
            </Collapsible>

            <div className="record-meta">
              <span>Attention {Math.round(item.attentionScore)}</span>
              <span>{Math.round(item.stalenessDays)} days stale</span>
              {item.lastInteraction && <span>Last active {new Date(item.lastInteraction).toLocaleString()}</span>}
            </div>
          </div>
        </SheetContent>
      </Sheet>
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
  const [busy, setBusy] = useState<string | null>(null);

  const connect = async (provider: "notion", token: string) => {
    setBusy(provider);
    try {
      await boardRequest({ action: "connect", provider, token });
      setNotionToken("");
      toast.success("Notion connected.");
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (provider: "notion") => {
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
          <div className="privacy-note"><CircleAlert /><p>Server-managed integration secrets never reach your browser. Tokens pasted here are encrypted before storage.</p></div>

          <section className="connection-card">
            <div className="connection-heading">
              <span className="notion-letter">N</span>
              <span><strong>Notion</strong><small>{data.connections.notion ? "Connected to All Items" : "Snapshot mode"}</small></span>
              <span className={data.connections.notion ? "status-live" : "status-off"}>{data.connections.notion ? "Live" : "Off"}</span>
            </div>
            {data.connections.notion ? (
              <div className="connection-actions">
                <Button onClick={() => void sync()} disabled={busy === "sync"}><RefreshCw className={busy === "sync" ? "animate-spin" : ""} />Sync now</Button>
                {data.connections.notionManaged ? (
                  <span className="managed-connection">Managed by this Site</span>
                ) : (
                  <Button variant="outline" onClick={() => void disconnect("notion")} disabled={busy === "notion"}>Disconnect</Button>
                )}
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
  const [mode, setMode] = useState<BoardMode>("home");
  const [search, setSearch] = useState("");
  const [view, setView] = useState("active");
  const [source, setSource] = useState("all");
  const [area, setArea] = useState("all");
  const [capture, setCapture] = useState("");
  const [capturing, setCapturing] = useState(false);
  const captureRef = useRef<HTMLInputElement>(null);
  const captureLock = useRef(false);
  const [eventCapture, setEventCapture] = useState("");
  const [goalCapture, setGoalCapture] = useState("");
  const [widgetTop, setWidgetTopState] = useState(true);
  useEffect(() => {
    try { setWidgetTopState(localStorage.getItem("burner-upcoming-position") !== "bottom"); } catch { /* per-viewer only */ }
  }, []);
  const setWidgetTop = (top: boolean) => {
    setWidgetTopState(top);
    try { localStorage.setItem("burner-upcoming-position", top ? "top" : "bottom"); } catch { /* per-viewer only */ }
  };
  const [demo, setDemo] = useState(false);
  const inboxRef = useRef<HTMLDivElement>(null);

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
    inbox: openItems.filter(item => !item.collection).length,
    today: openItems.filter(item => data?.lists.some(list => list.name === "Today" && belongsToList(item, list, data.lists))).length,
    reminders: openItems.filter((item) => item.itemType === "Reminder").length,
    completed: completedItems.length,
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    const query = search.trim().toLowerCase();
    return data.items.filter((item) => {
      if (view === "active" && ["Done", "Archived"].includes(item.status)) return false;
      if (view === "unrated" && (["Done", "Archived"].includes(item.status) || !needsPriority(item))) return false;
      if (view === "unfiled" && (["Done", "Archived"].includes(item.status) || item.collection)) return false;
      if (view === "no_due" && (["Done", "Archived"].includes(item.status) || item.priority === 0 || item.due || item.scheduledFor)) return false;
      if (view === "starred" && !item.starred) return false;
      if (view === "due" && !item.due) return false;
      if (view === "done" && !["Done", "Archived"].includes(item.status)) return false;
      if (source !== "all" && item.source !== source) return false;
      if (area !== "all" && item.area !== area) return false;
      if (query && ![item.title, item.originalNotes, item.collection, item.area, item.project, item.goal, item.tags, item.context].filter(Boolean).join(" ").toLowerCase().includes(query)) return false;
      return true;
    });
  }, [data, search, view, source, area]);

  const dashboard = useMemo(() => {
    const open = filtered.filter((item) => !["Done", "Archived"].includes(item.status));
    return {
      reminders: open.filter((item) => item.itemType === "Reminder").sort(urgencySort),
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
    if (!data) return false;
    const targetList = data.lists.find(list => list.name === changes.collection);
    if (targetList) changes = { ...listMoveChanges(targetList), ...changes };
    const moving = "collection" in changes;
    const sourceItem = data.items.find(item => item.id === id);
    const affected = (item: BoardItem) => item.id === id || Boolean(moving && sourceItem?.groupId && item.groupId === sourceItem.groupId);
    if (demo) {
      setData(current => current ? { ...current, items: current.items.map(item => affected(item) ? { ...item, ...changes, dirty: false } : item) } : current);
      return true;
    }
    setData(current => current ? { ...current, items: current.items.map(item => affected(item) ? { ...item, ...changes, dirty: true } : item) } : current);
    try {
      const result = await boardRequest({ action: "update", id, changes });
      setData((current) => current ? {
        ...current,
        items: current.items.map((item) => result.items?.find(updated => updated.id === item.id) || (item.id === id ? result.item : item)),
        collections: result.item.collection && !current.collections.includes(result.item.collection)
          ? [...current.collections, result.item.collection].sort()
          : current.collections,
      } : current);
      if (result.sync?.message) toast.warning(result.sync.message);
      else if (result.sync?.notion === false) toast.warning("Saved here. Notion will need a retry.");
      return true;
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "The change did not save.");
      await load();
      return false;
    }
  };

  // Phase 2: bulk actions. No batch API endpoint exists, so this calls the existing
  // single-item update once per id, sequentially (not Promise.all) - saveItem does an
  // optimistic local setData per call, and running many in parallel would interleave those
  // updates unpredictably. Reports partial failure honestly instead of assuming all-or-nothing.
  const bulkSave = async (ids: string[], changes: EditableChanges): Promise<{ applied: number; failed: number }> => {
    let applied = 0;
    let failed = 0;
    for (const id of ids) {
      if (await saveItem(id, changes)) applied++; else failed++;
    }
    if (failed === 0) toast.success(`Updated ${applied} task${applied === 1 ? "" : "s"}.`);
    else toast.warning(`Updated ${applied} of ${applied + failed}. ${failed} failed - try again for those.`);
    return { applied, failed };
  };

  const create = async () => {
    const title = capture.trim();
    if (!title || !data || captureLock.current) return;
    captureLock.current = true;
    setCapturing(true);
    try {
      const result = demo ? { item: { ...sampleBoard().items[0], id: crypto.randomUUID(), title, collection: null, priority: null } } : await boardRequest({ action: "create", title });
      setData(current => current ? { ...current, items: [result.item, ...current.items] } : current);
      setCapture(current => current.trim() === title ? "" : current);
      captureRef.current?.focus();
      toast.success("Captured. Organize it whenever you’re ready.", { action: { label: "Edit details", onClick: () => setSelectedId(result.item.id) } });
    } catch (captureError) {
      toast.error(captureError instanceof Error ? captureError.message : "Capture failed.");
    } finally {
      setCapturing(false);
      captureLock.current = false;
    }
  };

  const createEvent = async () => {
    const title = eventCapture.trim();
    if (!title || !data) return;
    try {
      const result = demo ? { item: { ...sampleBoard().items[0], id: crypto.randomUUID(), title, collection: null, priority: 0, itemType: "Event" } } : await boardRequest({ action: "create", title });
      setData(current => current ? { ...current, items: [result.item, ...current.items] } : current);
      setEventCapture("");
      if (!demo) await saveItem(result.item.id, { itemType: "Event", priority: 0 });
      toast.success("Event added.", { action: { label: "Edit details", onClick: () => setSelectedId(result.item.id) } });
    } catch (captureError) {
      toast.error(captureError instanceof Error ? captureError.message : "Could not add that event.");
    }
  };

  const createGoal = async () => {
    const title = goalCapture.trim();
    if (!title || !data) return;
    try {
      const result = demo ? { item: { ...sampleBoard().items[0], id: crypto.randomUUID(), title, collection: null, priority: null, itemType: "Goal" } } : await boardRequest({ action: "create", title });
      setData(current => current ? { ...current, items: [result.item, ...current.items] } : current);
      setGoalCapture("");
      if (!demo) await saveItem(result.item.id, { itemType: "Goal" });
      toast.success("Goal added.", { action: { label: "Edit details", onClick: () => setSelectedId(result.item.id) } });
    } catch (captureError) {
      toast.error(captureError instanceof Error ? captureError.message : "Could not add that goal.");
    }
  };

  const createList = async (name: string, type: string) => {
    if (!data) return;
    if (demo) { setData(current => current ? { ...current, lists: [...current.lists, { id: crypto.randomUUID(), name, type: type as BoardList["type"], showPriority: null, showLongTermGoals: null, reminderDefault: null, defaultItemType: null, sortOrder: current.lists.length }], collections: [...current.collections, name] } : current); return; }
    try {
      const result = await boardRequest({ action: "list_create", name, type });
      setData((current) => current ? { ...current, lists: [...current.lists, result.list], collections: [...new Set([...current.collections, result.list.name])].sort() } : current);
      toast.success(`Created "${name}".`);
    } catch (createError) {
      toast.error(createError instanceof Error ? createError.message : "The list could not be created.");
    }
  };

  const saveList = async (id: string, listChanges: EditableList) => {
    if (!data) return;
    try {
      const previous = data.lists.find(list => list.id === id);
      if (!previous) return;
      const newName = listChanges.name?.trim();
      if (newName && data.lists.some(list => list.id !== id && list.name === newName)) throw new Error("A list with that name already exists.");
      const result = demo ? { list: { ...previous, ...listChanges } } : await boardRequest({ action: "list_update", id, listChanges });
      setData((current) => current ? {
        ...current,
        lists: current.lists.map((list) => list.id === id ? result.list : list),
        collections: [...new Set(current.collections.map(name => name === previous.name ? result.list.name : name))].sort(),
        items: current.items.map(item => item.collection === previous.name ? { ...item, collection: result.list.name } : item),
      } : current);
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "The list did not save.");
    }
  };

  const saveVisibility = async (changes: Partial<HomeVisibility>) => {
    if (!data) return;
    const previous = data.visibility;
    setData((current) => current ? { ...current, visibility: { ...current.visibility, ...changes } } : current);
    if (demo) return;
    try {
      const result = await boardRequest({ action: "set_visibility", visibility: changes });
      setData((current) => current ? { ...current, visibility: result.visibility } : current);
    } catch (visibilityError) {
      setData((current) => current ? { ...current, visibility: previous } : current);
      toast.error(visibilityError instanceof Error ? visibilityError.message : "The setting did not save.");
    }
  };

  const reorderLists = async (orderedIds: string[], pin?: { id: string; pinned: boolean }) => {
    if (!data) return;
    const previousLists = data.lists;
    // Optimistic: renumber locally by the same index scheme the server will assign,
    // so the drag-drop feels instant instead of waiting on a round trip.
    setData((current) => current ? {
      ...current,
      lists: current.lists.map((list) => {
        const index = orderedIds.indexOf(list.id);
        return index === -1 ? list : { ...list, sortOrder: index, ...(pin?.id === list.id ? { pinned: pin.pinned } : {}) };
      }),
    } : current);
    if (demo) return;
    try {
      const result = await boardRequest({ action: "list_reorder", orderedIds, pin });
      setData((current) => current ? { ...current, lists: result.lists } : current);
    } catch (reorderError) {
      setData((current) => current ? { ...current, lists: previousLists } : current);
      toast.error(reorderError instanceof Error ? reorderError.message : "Could not reorder lists.");
    }
  };

  const deleteList = async (id: string) => {
    if (!data) return;
    const list = data.lists.find((entry) => entry.id === id);
    try {
      const result = demo ? { reassignedCount: data.items.filter(item => item.collection === list?.name).length } : await boardRequest({ action: "list_delete", id });
      setData((current) => current ? {
        ...current,
        lists: current.lists.filter((entry) => entry.id !== id),
        collections: current.collections.filter(name => name !== list?.name),
        items: current.items.map((item) => item.collection === list?.name ? { ...item, collection: null } : item),
      } : current);
      toast.success(result.reassignedCount ? `Deleted. ${result.reassignedCount} task${result.reassignedCount === 1 ? "" : "s"} moved to no list.` : "List deleted.");
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : "The list could not be deleted.");
    }
  };

  const deleteItem = async (id: string) => {
    if (!data) return;
    if (demo) { setData(current => current ? { ...current, items: current.items.filter(item => item.id !== id) } : current); return; }
    const previous = data.items;
    setData(current => current ? { ...current, items: current.items.filter(item => item.id !== id) } : current);
    try {
      const result = await boardRequest({ action: "delete_item", id });
      if (result.items) applyItemUpdates(result.items);
      toast.success("Task deleted.");
    } catch (deleteError) {
      setData(current => current ? { ...current, items: previous } : current);
      toast.error(deleteError instanceof Error ? deleteError.message : "The task could not be deleted.");
    }
  };

  // Phase 3 slice 2: focus.*/week.* go through commandRequest (the new versioned envelope), not
  // boardRequest - full board reload isn't needed since the response already carries the
  // refreshed focus/weekProgress bundle.
  const toggleFocus = async (itemId: string, focused: boolean) => {
    if (demo) { toast.info("Exit the sample board to use Focus."); return; }
    try {
      const result = await commandRequest("focus.set", { itemId, focused });
      setData((current) => current ? { ...current, focus: result.focus, weekProgress: result.weekProgress } : current);
    } catch (focusError) {
      toast.error(focusError instanceof Error ? focusError.message : "Focus could not be updated.");
    }
  };

  const commitToWeek = async (itemId: string) => {
    if (demo || !data?.weekProgress) { toast.info("Exit the sample board to use weekly progress."); return; }
    try {
      const result = await commandRequest("week.commit", { weekId: data.weekProgress.weekId, itemId });
      setData((current) => current ? { ...current, focus: result.focus, weekProgress: result.weekProgress } : current);
    } catch (commitError) {
      toast.error(commitError instanceof Error ? commitError.message : "Could not add that to this week.");
    }
  };

  const withdrawFromWeek = async (itemId: string, reason?: string) => {
    if (!data?.weekProgress) return;
    try {
      const result = await commandRequest("week.withdraw", { weekId: data.weekProgress.weekId, itemId, reason: reason ?? null });
      setData((current) => current ? { ...current, focus: result.focus, weekProgress: result.weekProgress } : current);
    } catch (withdrawError) {
      toast.error(withdrawError instanceof Error ? withdrawError.message : "Could not withdraw that from this week.");
    }
  };

  const closeWeek = async () => {
    if (!data?.weekProgress) return;
    try {
      const result = await commandRequest("week.close", { weekId: data.weekProgress.weekId });
      setData((current) => current ? { ...current, focus: result.focus, weekProgress: result.weekProgress } : current);
      toast.success("Week closed. The report is now frozen.");
    } catch (closeError) {
      toast.error(closeError instanceof Error ? closeError.message : "Could not close this week.");
    }
  };

  /** One toggle for the Home-page row buttons - commits or withdraws depending on the requested
   * next state, so TaskRow doesn't need to know which of the two commands applies. */
  const toggleWeekCommitment = async (itemId: string, committed: boolean) => {
    if (committed) await commitToWeek(itemId); else await withdrawFromWeek(itemId);
  };

  // Phase 3 extension (docs/adr/local/time-horizon-quick-actions.md): Today/Month/Year mirror
  // week.commit/week.withdraw above exactly, via the generic period.commit/period.withdraw
  // commands - one parameterized pair instead of three near-duplicate copies of
  // commitToWeek/withdrawFromWeek/toggleWeekCommitment.
  type PeriodKey = "today" | "month" | "year";
  const PERIOD_TYPE_BY_KEY: Record<PeriodKey, "day" | "month" | "year"> = { today: "day", month: "month", year: "year" };
  const PERIOD_PROGRESS_KEY: Record<PeriodKey, "todayProgress" | "monthProgress" | "yearProgress"> = { today: "todayProgress", month: "monthProgress", year: "yearProgress" };

  const commitToPeriod = async (key: PeriodKey, itemId: string) => {
    const progress = data?.[PERIOD_PROGRESS_KEY[key]];
    if (demo || !progress) { toast.info("Exit the sample board to use planning periods."); return; }
    try {
      const result = await commandRequest("period.commit", { periodType: PERIOD_TYPE_BY_KEY[key], periodId: progress.periodId, itemId });
      setData((current) => current ? { ...current, focus: result.focus, todayProgress: result.todayProgress, monthProgress: result.monthProgress, yearProgress: result.yearProgress } : current);
    } catch (commitError) {
      toast.error(commitError instanceof Error ? commitError.message : "Could not add that.");
    }
  };

  const withdrawFromPeriod = async (key: PeriodKey, itemId: string, reason?: string) => {
    const progress = data?.[PERIOD_PROGRESS_KEY[key]];
    if (!progress) return;
    try {
      const result = await commandRequest("period.withdraw", { periodType: PERIOD_TYPE_BY_KEY[key], periodId: progress.periodId, itemId, reason: reason ?? null });
      setData((current) => current ? { ...current, focus: result.focus, todayProgress: result.todayProgress, monthProgress: result.monthProgress, yearProgress: result.yearProgress } : current);
    } catch (withdrawError) {
      toast.error(withdrawError instanceof Error ? withdrawError.message : "Could not withdraw that.");
    }
  };

  const togglePeriodCommitment = async (key: PeriodKey, itemId: string, committed: boolean) => {
    if (committed) await commitToPeriod(key, itemId); else await withdrawFromPeriod(key, itemId);
  };
  const toggleToday = (itemId: string, committed: boolean) => togglePeriodCommitment("today", itemId, committed);
  const toggleMonth = (itemId: string, committed: boolean) => togglePeriodCommitment("month", itemId, committed);
  const toggleYear = (itemId: string, committed: boolean) => togglePeriodCommitment("year", itemId, committed);

  // Row-level quick actions (Home page only - see TaskRow's doc comment) need fast, per-item
  // lookups rather than re-scanning the arrays on every row render.
  const focusedIds = useMemo(() => new Set(data?.focus?.map((entry) => entry.itemId)), [data?.focus]);
  const activeIds = (progress: { commitments: { itemId: string; withdrawnAt: string | null }[] } | undefined) =>
    new Set(progress?.commitments.filter((commitment) => !commitment.withdrawnAt).map((commitment) => commitment.itemId));
  const weekCommittedIds = useMemo(() => activeIds(data?.weekProgress), [data?.weekProgress]);
  const todayIds = useMemo(() => activeIds(data?.todayProgress), [data?.todayProgress]);
  const monthIds = useMemo(() => activeIds(data?.monthProgress), [data?.monthProgress]);
  const yearIds = useMemo(() => activeIds(data?.yearProgress), [data?.yearProgress]);

  const applyItemUpdates = (updated: BoardItem[]) => {
    setData((current) => current ? {
      ...current,
      items: current.items.map((item) => updated.find((entry) => entry.id === item.id) || item),
    } : current);
  };

  const mergeItems = async (draggedId: string, targetId: string) => {
    if (demo) { toast.info("Exit the sample board to manage real lists and groups."); return; }
    if (!data) return;
    // Phase 2 (docs/plans/burner-board-roadmap.md, domain rule 12): prevent NEW cross-List
    // merges for first-release group consistency. Extending an EXISTING group (either item
    // already carries a groupId) is unaffected - only a brand-new merge across different lists
    // is blocked. This is a client-side guard only; board-store.ts isn't in Phase 2's scope, so
    // the server itself doesn't enforce this yet.
    const dragged = data.items.find((item) => item.id === draggedId);
    const target = data.items.find((item) => item.id === targetId);
    const formingNewGroup = !dragged?.groupId && !target?.groupId;
    if (formingNewGroup && (dragged?.collection || null) !== (target?.collection || null)) {
      toast.info("Grouping across different lists isn't supported yet - move them to the same list first.");
      return;
    }
    try {
      const result = await boardRequest({ action: "merge_items", id: draggedId, targetId });
      applyItemUpdates(result.items);
    } catch (mergeError) {
      toast.error(mergeError instanceof Error ? mergeError.message : "Could not merge those tasks.");
    }
  };

  const unlinkItem = async (id: string) => {
    if (demo) { toast.info("Exit the sample board to manage real lists and groups."); return; }
    if (!data) return;
    try {
      const result = await boardRequest({ action: "unlink_item", id });
      applyItemUpdates(result.items);
    } catch (unlinkError) {
      toast.error(unlinkError instanceof Error ? unlinkError.message : "Could not unlink that task.");
    }
  };

  const disbandGroup = async (anchorId: string) => {
    if (demo) { toast.info("Exit the sample board to manage real lists and groups."); return; }
    if (!data) return;
    try {
      const result = await boardRequest({ action: "disband_group", id: anchorId });
      applyItemUpdates(result.items);
      toast.success("Group disbanded.");
    } catch (disbandError) {
      toast.error(disbandError instanceof Error ? disbandError.message : "Could not disband that group.");
    }
  };

  const exportCsv = () => {
    if (!data) return;
    const keys: Array<keyof BoardItem> = ["title", "status", "collection", "priority", "itemType", "source", "due", "scheduledFor", "dateMode", "recurrence", "reminderTime", "energy", "context", "area", "project", "goal", "originalNotes", "lastInteraction", "completedAt", "starred", "id"];
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark"><Flame /></span>
          <span><strong>Burner Board</strong><small>{displayName.split(" ")[0]}’s task desk</small></span>
        </div>
        <div className="sync-cluster">
          <span className={data.connections.notion ? "sync-state live" : "sync-state snapshot"}><span />{data.connections.notion ? "Notion live" : "Snapshot"}</span>
          <a href="/guide/ai" className="icon-button" aria-label="AI setup guide" title="AI setup guide"><BookOpen /></a>
          <button type="button" className="icon-button" onClick={() => demo ? toast.info("Exit the sample board to manage connections.") : setSettingsOpen(true)} aria-label="Open connections"><Settings2 /></button>
        </div>
      </header>

      {demo ? <div className="demo-banner"><span>Sample board · Changes here are temporary.</span><Button variant="ghost" onClick={() => { setDemo(false); setMode("home"); void load(); }}>Exit sample board</Button></div> : !data.items.length && <div className="demo-banner"><span>Try the new organizing flow with a few example tasks.</span><Button variant="outline" onClick={() => { setDemo(true); setData(sampleBoard()); setMode("organize"); }}>Try sample board</Button></div>}
      {mode !== "organize" && <section className="command-deck">
        <div className="capture-box">
          <Plus />
          <input ref={captureRef} value={capture} onChange={(event) => setCapture(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void create(); }} placeholder="Capture something before it disappears..." aria-label="Quick capture" />
          <button type="button" onClick={() => void create()} disabled={!capture.trim() || capturing}>{capturing ? <Loader2 className="animate-spin" /> : "Add"}</button>
        </div>
        <div className="stat-strip">
          {[...data.lists].filter(list => list.pinned).sort((a, b) => a.sortOrder - b.sortOrder).slice(0, 2).map(list => (
            <button type="button" key={list.id} onClick={() => { setMode("home"); setView("active"); requestAnimationFrame(() => document.getElementById("home-list-" + list.id)?.scrollIntoView({ behavior: "smooth" })); }}>
              <span>{openItems.filter(item => belongsToList(item, list, data.lists)).length}</span>{list.name}
            </button>
          ))}
          <button type="button" className="front-stat" onClick={() => { setMode("reminders"); setView("active"); }}><span>{stats.reminders}</span>Reminders</button>
          <button type="button" className="finished-stat" onClick={() => { setMode("completed"); setView("all"); }}><span>{stats.completed}</span>Finished</button>
        </div>
      </section>}

      <section className="view-switcher">
        <Tabs value={mode} onValueChange={(value) => {
          setMode(value as BoardMode);
          setView(value === "completed" ? "all" : "active");
        }}>
          <TabsList>
            <TabsTrigger value="home"><CalendarClock />Home</TabsTrigger>
            <TabsTrigger value="organize"><ListChecks />Organize</TabsTrigger>
            <TabsTrigger value="calendar"><CalendarDays />Calendar</TabsTrigger>
            <TabsTrigger value="goals"><Target />Goals</TabsTrigger>
            <TabsTrigger value="reminders"><BellRing />Reminders</TabsTrigger>
            <TabsTrigger value="focus"><Star />Focus</TabsTrigger>
            <TabsTrigger value="completed"><Trophy />History</TabsTrigger>
          </TabsList>
        </Tabs>
        <p>{mode === "home"
          ? "Your pinned lists are first. Move tasks, reorder lists, and use Manage to change each list’s settings."
          : mode === "organize"
            ? "A focused pass through your tasks. Save, skip, or undo."
            : mode === "calendar"
            ? "Recurring events and things you want to track on a calendar. They stay out of your lists."
            : mode === "goals"
            ? "Every long-term goal, in one place, regardless of any list's visibility setting."
            : mode === "reminders"
            ? "Recurring items live here. Notification delivery can connect to Apple Reminders or Google Calendar later."
            : mode === "focus"
            ? "Current priorities and this week's selected work, independent of lists and dates."
            : "Completed and archived work, searchable by list and date. Archived items stay recoverable."}</p>
      </section>

      {mode !== "organize" && mode !== "focus" && <section className="filterbar">
        <div className="search-box"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks, lists, notes..." /></div>
        <Select value={view} onValueChange={setView}>
          <SelectTrigger className="filter-select"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Open items</SelectItem>
            <SelectItem value="unrated">Needs review</SelectItem>
            <SelectItem value="unfiled">Unfiled (no list)</SelectItem>
            <SelectItem value="no_due">No due date</SelectItem>
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
        <span className="result-count">{filtered.length} matching</span>
      </section>}

      {mode === "organize" ? <OrganizeMode items={data.items} lists={data.lists} onSave={saveItem} onHome={() => setMode("home")} /> : mode === "home" ? (
        <section className="collections-wrap" ref={inboxRef}>
          {widgetTop && <UpcomingWidget items={openItems} position="top" onOpen={(item) => setSelectedId(item.id)} onMove={() => setWidgetTop(false)} />}
          {!data.lists.some(list => list.rule === "inbox") && filtered.some(item => !item.collection && item.itemType !== "Event") && (
            <TaskTable title="Unfiled tasks" note="These tasks have no list. Move them into a list, or set any list’s Tasks shown setting to Unfiled tasks."
              items={filtered.filter(item => !item.collection && item.itemType !== "Event")} icon={Inbox} empty="No unfiled tasks"
              collections={data.collections} onOpen={item => setSelectedId(item.id)} onSave={(id, changes) => void saveItem(id, changes)} onDelete={(id) => void deleteItem(id)} onBulkSave={bulkSave}
              focusedIds={focusedIds} weekCommittedIds={weekCommittedIds} todayIds={todayIds} monthIds={monthIds} yearIds={yearIds}
              onToggleFocus={(id, focused) => void toggleFocus(id, focused)} onToggleWeek={(id, committed) => void toggleWeekCommitment(id, committed)}
              onToggleToday={(id, committed) => void toggleToday(id, committed)} onToggleMonth={(id, committed) => void toggleMonth(id, committed)} onToggleYear={(id, committed) => void toggleYear(id, committed)} />
          )}
          <CollectionsView
            items={filtered.filter(item => item.itemType !== "Event")}
            allItems={data.items}
            lists={data.lists}
            visibility={data.visibility}
            onSaveVisibility={(changes) => void saveVisibility(changes)}
            onCreateList={(name, type) => void createList(name, type)}
            onDeleteList={(id) => void deleteList(id)}
            onReorderLists={(orderedIds, pin) => void reorderLists(orderedIds, pin)}
            onOpen={(item) => setSelectedId(item.id)}
            onSaveItem={(id, changes) => void saveItem(id, changes)}
            onSaveList={(id, changes) => void saveList(id, changes)}
            onMergeInto={(draggedId, targetId) => void mergeItems(draggedId, targetId)}
            onUnlinkItem={(id) => void unlinkItem(id)}
            onDisbandGroup={(id) => void disbandGroup(id)}
            onDeleteItem={(id) => void deleteItem(id)}
            onBulkSave={bulkSave}
            focusedIds={focusedIds}
            weekCommittedIds={weekCommittedIds}
            todayIds={todayIds}
            monthIds={monthIds}
            yearIds={yearIds}
            onToggleFocus={(id, focused) => void toggleFocus(id, focused)}
            onToggleWeek={(id, committed) => void toggleWeekCommitment(id, committed)}
            onToggleToday={(id, committed) => void toggleToday(id, committed)}
            onToggleMonth={(id, committed) => void toggleMonth(id, committed)}
            onToggleYear={(id, committed) => void toggleYear(id, committed)}
          />
          {!widgetTop && <UpcomingWidget items={openItems} position="bottom" onOpen={(item) => setSelectedId(item.id)} onMove={() => setWidgetTop(true)} />}
        </section>
      ) : mode === "calendar" ? (
        <section className="dashboard-wrap single-table-wrap">
          <div className="capture-box calendar-capture">
            <CalendarDays />
            <input value={eventCapture} onChange={(event) => setEventCapture(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void createEvent(); }} placeholder="Add an event or recurring reminder..." aria-label="Add event" />
            <button type="button" onClick={() => void createEvent()} disabled={!eventCapture.trim()}>Add</button>
          </div>
          <TaskTable
            collections={data.collections}
            empty="No events yet. Add one above, or set a task's type to Event."
            icon={CalendarDays}
            items={filtered.filter(item => item.itemType === "Event").sort((a, b) => (plannedDate(a) || "9999").localeCompare(plannedDate(b) || "9999"))}
            note="Sorted by date. Repeat rules keep these off your task lists."
            onBulkSave={bulkSave}
            onOpen={(item) => setSelectedId(item.id)}
            onSave={(id, changes) => void saveItem(id, changes)}
            onDelete={(id) => void deleteItem(id)}
            title="Events"
          />
        </section>
      ) : mode === "goals" ? (
        <section className="dashboard-wrap single-table-wrap">
          <div className="capture-box goal-capture">
            <Target />
            <input value={goalCapture} onChange={(event) => setGoalCapture(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void createGoal(); }} placeholder="Add a long-term goal..." aria-label="Add goal" />
            <button type="button" onClick={() => void createGoal()} disabled={!goalCapture.trim()}>Add</button>
          </div>
          <TaskTable
            collections={data.collections}
            empty="No goals yet. Add one above, or set a task's type to Goal."
            icon={Target}
            items={filtered.filter(item => item.itemType === "Goal").sort((a, b) => compareListItems(a, b, "priority", effectiveAttention))}
            note="Shown here no matter which lists hide goals."
            onBulkSave={bulkSave}
            onOpen={(item) => setSelectedId(item.id)}
            onSave={(id, changes) => void saveItem(id, changes)}
            onDelete={(id) => void deleteItem(id)}
            title="Goals"
          />
        </section>
      ) : mode === "reminders" ? (
        <section className="dashboard-wrap single-table-wrap">
          <div className="reminder-note"><BellRing /><span><strong>Reminder schedule</strong><small>Dates, times, and repeat rules are saved now. Apple Reminders or Google Calendar can handle notifications when that connection is added.</small></span></div>
          <TaskTable
            collections={data.collections}
            empty="No recurring reminders yet"
            icon={BellRing}
            items={dashboard.reminders}
            note="Edit the date, time, and repeat rule without leaving this list."
            onBulkSave={bulkSave}
            onDrop={(id) => void saveItem(id, { itemType: "Reminder", priority: 0 })}
            onOpen={(item) => setSelectedId(item.id)}
            onSave={(id, changes) => void saveItem(id, changes)}
            onDelete={(id) => void deleteItem(id)}
            title="Reminders"
          />
        </section>
      ) : mode === "focus" ? (
        <section className="dashboard-wrap single-table-wrap flex flex-col gap-4">
          {data.weekProgress && data.focus ? (
            <>
              <FocusView focusItems={data.focus} items={openItems} onToggleFocus={toggleFocus} />
              {data.todayProgress && <PeriodProgress title="Today" periodProgress={data.todayProgress} items={openItems} onCommit={(id) => commitToPeriod("today", id)} onWithdraw={(id) => withdrawFromPeriod("today", id)} />}
              <WeeklyProgress weekProgress={data.weekProgress} items={openItems} onCommit={commitToWeek} onWithdraw={withdrawFromWeek} onClose={closeWeek} />
              {data.monthProgress && <PeriodProgress title="This month" periodProgress={data.monthProgress} items={openItems} onCommit={(id) => commitToPeriod("month", id)} onWithdraw={(id) => withdrawFromPeriod("month", id)} />}
              {data.yearProgress && <PeriodProgress title="This year" periodProgress={data.yearProgress} items={openItems} onCommit={(id) => commitToPeriod("year", id)} onWithdraw={(id) => withdrawFromPeriod("year", id)} />}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Focus and planning progress aren&apos;t available in the sample board.</p>
          )}
        </section>
      ) : (
        <section className="dashboard-wrap history-wrap">
          <div className="productivity-stats">
            <span><strong>{completedItems.length}</strong><small>Finished total</small></span>
            <span><strong>{completedThisWeek}</strong><small>Last 7 days</small></span>
            <span><strong>{completedThisMonth}</strong><small>This month</small></span>
          </div>
          <HistoryView
            items={data.items}
            collections={data.collections}
            onBulkSave={bulkSave}
            onOpen={(item) => setSelectedId(item.id)}
            onSave={(id, changes) => void saveItem(id, changes)}
            onDelete={(id) => void deleteItem(id)}
          />
        </section>
      )}

      <div className="mobile-hint"><ArrowUpDown />Hover for quick actions. Tap the title for every field.</div>

      <EditorSheet
        collections={data.collections}
        item={selected}
        key={selected?.id || "none"}
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
