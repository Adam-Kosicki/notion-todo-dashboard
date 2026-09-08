"use client";

// Phase 3 extension (docs/adr/local/time-horizon-quick-actions.md, 2026-09-08): a generic
// Today/Month/Year progress panel over the period.commit/period.withdraw commands
// (lib/server/commands.ts) and the live stats from lib/server/queries.ts's getPeriodProgress.
// One component parameterized by periodType rather than three near-identical files - mirrors
// components/board/weekly-progress.tsx's shape exactly, minus the close-week control: v1 periods
// never close (see commands.ts's periodCommitPlan comment for why).
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { BoardItem, PeriodProgress as PeriodProgressData } from "@/lib/board-types";

function formatPeriodLabel(periodType: PeriodProgressData["periodType"], startDate: string) {
  const date = new Date(`${startDate}T00:00:00Z`);
  if (periodType === "day") return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  if (periodType === "month") return date.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  return date.toLocaleDateString(undefined, { year: "numeric", timeZone: "UTC" });
}

export function PeriodProgress({
  title,
  periodProgress,
  items,
  onCommit,
  onWithdraw,
}: {
  title: string;
  periodProgress: PeriodProgressData;
  items: BoardItem[];
  onCommit: (itemId: string) => Promise<void>;
  onWithdraw: (itemId: string, reason?: string) => Promise<void>;
}) {
  const [addValue, setAddValue] = useState("");
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const { stats } = periodProgress;
  const committedIds = new Set(periodProgress.commitments.map((commitment) => commitment.itemId));
  const addableItems = items
    .filter((item) => !["Done", "Archived"].includes(item.status) && !committedIds.has(item.id))
    .sort((a, b) => a.title.localeCompare(b.title));

  const commit = async (itemId: string) => {
    if (!itemId) return;
    setBusyItemId(itemId);
    try {
      await onCommit(itemId);
      setAddValue("");
    } finally {
      setBusyItemId(null);
    }
  };

  const withdraw = async (itemId: string) => {
    setBusyItemId(itemId);
    try {
      await onWithdraw(itemId);
    } finally {
      setBusyItemId(null);
    }
  };

  const percentage = stats.status === "computed" && stats.taskCommitments > 0 ? Math.round((stats.completed / stats.taskCommitments) * 100) : 0;

  return (
    <div className="weekly-progress flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{formatPeriodLabel(periodProgress.periodType, periodProgress.startDate)}</p>
      </div>

      {stats.status === "no_commitments" ? (
        <p className="text-muted-foreground">No tasks planned</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold text-foreground">{stats.completionRatioLabel}</span>
            <span className="text-sm text-muted-foreground">{percentage}%</span>
          </div>
          <Progress value={percentage} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{stats.added} added</span>
            <span>{stats.withdrawn} withdrawn</span>
            {stats.lateCompletions > 0 && <span>{stats.lateCompletions} completed late</span>}
            {stats.goalMilestonesCompleted > 0 && <span>{stats.goalMilestonesCompleted} goal milestone{stats.goalMilestonesCompleted === 1 ? "" : "s"}</span>}
          </div>
        </div>
      )}

      <ul className="flex flex-col gap-1">
        {periodProgress.commitments.map((commitment) => {
          const done = commitment.status === "Done";
          const withdrawn = Boolean(commitment.withdrawnAt);
          return (
            <li key={commitment.itemId} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
              <span className={`truncate text-sm ${withdrawn ? "text-muted-foreground line-through" : done ? "text-muted-foreground" : "text-foreground"}`}>
                {commitment.title}
              </span>
              {!withdrawn && (
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  disabled={busyItemId === commitment.itemId}
                  onClick={() => void withdraw(commitment.itemId)}
                  aria-label={`Withdraw ${commitment.title} from ${title}`}
                  title={`Withdraw from ${title}`}
                >
                  <X className="size-4" />
                </button>
              )}
              {withdrawn && <span className="shrink-0 text-xs text-muted-foreground">withdrawn</span>}
            </li>
          );
        })}
        {periodProgress.commitments.length === 0 && <li className="text-sm text-muted-foreground">Nothing selected yet.</li>}
      </ul>

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <select
          className="flex-1 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
          value={addValue}
          onChange={(event) => setAddValue(event.target.value)}
          aria-label={`Add a task to ${title}`}
        >
          <option value="">Add a task to {title.toLowerCase()}...</option>
          {addableItems.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          disabled={!addValue || busyItemId === addValue}
          onClick={() => void commit(addValue)}
        >
          <Plus className="size-4" />Add
        </button>
      </div>
    </div>
  );
}
