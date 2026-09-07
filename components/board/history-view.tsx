"use client";

// Phase 2 (docs/plans/burner-board-roadmap.md): History with search, List/date filters, and
// separate Archived filters. "Deleted" isn't a real state in the live app yet - the legacy
// delete path (board-store.ts's deleteItem) hard-deletes; Phase 1's tombstone (deleted_at)
// only exists in the new d1_primary command layer, not wired into this UI until a later
// phase's cutover. Rather than show a fake, always-empty "Deleted" filter, this only offers
// the two states that are actually real today: Completed and Archived.
import { useMemo, useState } from "react";
import { Archive, Search, Trophy } from "lucide-react";
import type { BoardItem, EditableChanges } from "@/lib/board-types";
import { TaskTable } from "@/app/board-app";

const INITIAL_ROW_CAP = 50;
const DATE_RANGES = [
  { value: "all", label: "All time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
] as const;

function historyDate(item: BoardItem, status: "done" | "archived") {
  return status === "done" ? (item.completedAt || item.updatedAt) : item.updatedAt;
}

export function HistoryView({
  items,
  collections,
  onOpen,
  onSave,
  onDelete,
  onBulkSave,
}: {
  items: BoardItem[];
  collections: string[];
  onOpen: (item: BoardItem) => void;
  onSave: (id: string, changes: EditableChanges) => void;
  onDelete: (id: string) => void;
  onBulkSave: (ids: string[], changes: EditableChanges) => Promise<{ applied: number; failed: number }>;
}) {
  const [status, setStatus] = useState<"done" | "archived">("done");
  const [search, setSearch] = useState("");
  const [listFilter, setListFilter] = useState("all");
  const [dateRange, setDateRange] = useState<(typeof DATE_RANGES)[number]["value"]>("all");
  const [showAll, setShowAll] = useState(false);

  const scoped = useMemo(() => items.filter((item) => item.status === (status === "done" ? "Done" : "Archived")), [items, status]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const cutoff = dateRange === "all" ? null : (() => {
      const date = new Date();
      date.setDate(date.getDate() - Number(dateRange));
      return date.toISOString();
    })();
    return scoped.filter((item) => {
      if (listFilter !== "all" && item.collection !== listFilter) return false;
      if (cutoff && historyDate(item, status) < cutoff) return false;
      if (query && ![item.title, item.originalNotes, item.collection, item.tags].filter(Boolean).join(" ").toLowerCase().includes(query)) return false;
      return true;
    }).sort((a, b) => historyDate(b, status).localeCompare(historyDate(a, status)));
  }, [scoped, search, listFilter, dateRange, status]);

  const visible = showAll ? filtered : filtered.slice(0, INITIAL_ROW_CAP);

  return (
    <section className="history-view">
      <div className="history-toggle" role="tablist" aria-label="History status">
        <button type="button" role="tab" aria-selected={status === "done"} className={status === "done" ? "selected" : ""} onClick={() => setStatus("done")}><Trophy />Completed<span>{scoped.length && status === "done" ? scoped.length : items.filter((item) => item.status === "Done").length}</span></button>
        <button type="button" role="tab" aria-selected={status === "archived"} className={status === "archived" ? "selected" : ""} onClick={() => setStatus("archived")}><Archive />Archived<span>{items.filter((item) => item.status === "Archived").length}</span></button>
      </div>
      <div className="history-filters">
        <div className="search-box"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search finished tasks..." aria-label="Search history" /></div>
        <select value={listFilter} onChange={(event) => { setListFilter(event.target.value); setShowAll(false); }} aria-label="Filter by list">
          <option value="all">All lists</option>
          {collections.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={dateRange} onChange={(event) => { setDateRange(event.target.value as typeof dateRange); setShowAll(false); }} aria-label="Filter by date">
          {DATE_RANGES.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
        </select>
        <span className="result-count">{filtered.length} matching</span>
      </div>
      <TaskTable
        collections={collections}
        completed={status === "done"}
        empty={filtered.length === 0 && scoped.length > 0 ? "Nothing matches these filters" : status === "done" ? "Finished tasks will appear here" : "Nothing archived"}
        icon={status === "done" ? Trophy : Archive}
        items={visible}
        note={status === "done" ? "Your productivity history" : "Removed from active views, but still recoverable"}
        onBulkSave={onBulkSave}
        onDelete={onDelete}
        onOpen={onOpen}
        onSave={onSave}
        title={status === "done" ? "Finished" : "Archived"}
      />
      {!showAll && filtered.length > INITIAL_ROW_CAP && (
        <button type="button" className="history-show-all" onClick={() => setShowAll(true)}>
          Show all {filtered.length} (currently showing {INITIAL_ROW_CAP})
        </button>
      )}
    </section>
  );
}
