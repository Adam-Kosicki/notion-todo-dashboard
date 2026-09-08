"use client";

// Phase 3 slice 2 (docs/plans/burner-board-roadmap.md): the weekly-progress UI over the
// week.commit/week.withdraw/week.close commands (lib/server/commands.ts) and the live/frozen
// stats from lib/server/queries.ts's getWeekProgress. Purely presentational plus the three
// mutation callbacks it's handed - all authorization, atomicity, and the statistics contract
// itself live server-side (lib/domain/progress.ts), not here.
import { useState } from "react";
import { CalendarCheck, CheckCircle2, Lock, Plus, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import type { BoardItem, WeekProgress } from "@/lib/board-types";

function formatWeekStart(startDate: string) {
  const date = new Date(`${startDate}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" });
}

export function WeeklyProgress({
  weekProgress,
  items,
  onCommit,
  onWithdraw,
  onClose,
}: {
  weekProgress: WeekProgress;
  items: BoardItem[];
  onCommit: (itemId: string) => Promise<void>;
  onWithdraw: (itemId: string, reason?: string) => Promise<void>;
  onClose: () => Promise<void>;
}) {
  const [addValue, setAddValue] = useState("");
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const { stats } = weekProgress;
  const committedIds = new Set(weekProgress.commitments.map((commitment) => commitment.itemId));
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

  const close = async () => {
    if (!window.confirm("Close this week? The report freezes permanently - later edits won't change it.")) return;
    setClosing(true);
    try {
      await onClose();
    } finally {
      setClosing(false);
    }
  };

  const percentage = stats.status === "computed" && stats.taskCommitments > 0 ? Math.round((stats.completed / stats.taskCommitments) * 100) : 0;

  return (
    <div className="weekly-progress flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Week of {formatWeekStart(weekProgress.startDate)}</h2>
          <p className="text-sm text-muted-foreground">{weekProgress.timezone}</p>
        </div>
        <Badge variant={weekProgress.status === "closed" ? "secondary" : weekProgress.status === "closing" ? "outline" : "default"}>
          {weekProgress.status === "closed" ? "Closed" : weekProgress.status === "closing" ? "Closing..." : "Open"}
        </Badge>
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
        {weekProgress.commitments.map((commitment) => {
          const done = commitment.status === "Done";
          const withdrawn = Boolean(commitment.withdrawnAt);
          return (
            <li key={commitment.itemId} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
              <span className={`flex items-center gap-2 truncate text-sm ${withdrawn ? "text-muted-foreground line-through" : done ? "text-muted-foreground" : "text-foreground"}`}>
                {done && <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />}
                <span className="truncate">{commitment.title}</span>
              </span>
              {weekProgress.status === "open" && !withdrawn && (
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  disabled={busyItemId === commitment.itemId}
                  onClick={() => void withdraw(commitment.itemId)}
                  aria-label={`Withdraw ${commitment.title} from this week`}
                  title="Withdraw from this week"
                >
                  <X className="size-4" />
                </button>
              )}
              {withdrawn && <span className="shrink-0 text-xs text-muted-foreground">withdrawn</span>}
            </li>
          );
        })}
        {weekProgress.commitments.length === 0 && <li className="text-sm text-muted-foreground">Nothing selected for this week yet.</li>}
      </ul>

      {weekProgress.status === "open" && (
        <div className="flex items-center gap-2 border-t border-border pt-3">
          <select
            className="flex-1 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
            value={addValue}
            onChange={(event) => setAddValue(event.target.value)}
            aria-label="Add a task to this week"
          >
            <option value="">Add a task to this week...</option>
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
      )}

      {weekProgress.status === "open" && (
        <button
          type="button"
          className="flex items-center justify-center gap-1.5 self-end rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          disabled={closing}
          onClick={() => void close()}
        >
          <Lock className="size-4" />{closing ? "Closing..." : "Close week"}
        </button>
      )}
      {weekProgress.status === "closed" && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarCheck className="size-3.5" />This week&apos;s report is frozen - later edits won&apos;t change it.</p>
      )}
    </div>
  );
}
