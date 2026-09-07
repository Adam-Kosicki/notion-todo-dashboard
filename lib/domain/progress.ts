// Phase 3 (docs/plans/burner-board-roadmap.md, section 6 "Weekly statistics contract"). Pure,
// DB-free so every rule in the contract is directly unit-testable (tests/progress.test.mjs)
// without D1. lib/server/commands.ts's weekClose calls computeWeekStats once to produce the
// frozen snapshot stored in planning_weeks.report_json; nothing here reads or writes a database.

export type CommitmentInput = {
  itemId: string;
  addedAt: string;
  withdrawnAt: string | null;
};

export type ItemEventInput = {
  itemId: string;
  eventType: "items.complete" | "items.reopen";
  timestamp: string;
};

export type CommitmentItemInfo = {
  /** "Goal" and "Reference" are excluded from the task completion ratio (contract rule: "Goals
   * and reference records are excluded from the task ratio; show goal milestones separately"). */
  itemType: string;
};

export type WeekStats =
  | { status: "no_commitments"; label: "No tasks planned" }
  | {
      status: "computed";
      totalCommitments: number;
      taskCommitments: number;
      completed: number;
      added: number;
      withdrawn: number;
      lateCompletions: number;
      goalMilestonesCompleted: number;
      completionRatioLabel: string;
    };

/**
 * `week.endDate` is exclusive (the calendar date the following week starts on) - see
 * weekEndDate(). A task contributes at most once (keyed by itemId), matching "a task
 * contributes once per week, even if shown in several views."
 */
export function computeWeekStats(params: {
  week: { startDate: string; endDate: string };
  commitments: CommitmentInput[];
  itemsById: Record<string, CommitmentItemInfo>;
  events: ItemEventInput[];
}): WeekStats {
  const { week, commitments, itemsById, events } = params;
  if (commitments.length === 0) {
    return { status: "no_commitments", label: "No tasks planned" };
  }

  // Events must be time-sorted per item so a reopen that arrives after a complete (regardless
  // of insertion order) correctly cancels that completion's contribution - contract rule:
  // "Reopen within the same week reverses its current completion contribution."
  const eventsByItem = new Map<string, ItemEventInput[]>();
  for (const event of events) {
    const list = eventsByItem.get(event.itemId) ?? [];
    list.push(event);
    eventsByItem.set(event.itemId, list);
  }
  for (const list of eventsByItem.values()) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  let taskCommitments = 0;
  let completed = 0;
  let lateCompletions = 0;
  let goalMilestonesCompleted = 0;

  for (const commitment of commitments) {
    const info = itemsById[commitment.itemId];
    const isTask = info ? info.itemType !== "Goal" && info.itemType !== "Reference" : true;
    if (isTask) taskCommitments++;

    // Walk this item's complete/reopen history chronologically; the most recent "complete" not
    // since reversed by a "reopen" is its completion timestamp, or null if never completed (or
    // reopened after).
    let completedAt: string | null = null;
    for (const event of eventsByItem.get(commitment.itemId) ?? []) {
      completedAt = event.eventType === "items.complete" ? event.timestamp : null;
    }
    if (!completedAt) continue;

    if (completedAt >= week.startDate && completedAt < week.endDate) {
      if (isTask) completed++;
      else goalMilestonesCompleted++;
    } else if (completedAt >= week.endDate && isTask) {
      // Contract rule: "Completion outside the week is shown as late completion, not rewritten
      // as on-time success." Only completions after the week ends count as late here - a
      // completion timestamped before the week started isn't this week's commitment to begin
      // with, so it's neither on-time nor late for this report.
      lateCompletions++;
    }
  }

  return {
    status: "computed",
    totalCommitments: commitments.length,
    taskCommitments,
    completed,
    // Contract rule: "Define the displayed denominator as all commitments added to the week,
    // including withdrawals; do not improve the percentage by withdrawing unfinished work" - so
    // `added` is every commitment row, full stop, not just the currently-active ones.
    added: commitments.length,
    withdrawn: commitments.filter((commitment) => commitment.withdrawnAt).length,
    lateCompletions,
    goalMilestonesCompleted,
    completionRatioLabel: `${completed}/${taskCommitments}`,
  };
}

/** Exclusive end of the week starting on `startDate` (a YYYY-MM-DD calendar date). */
export function weekEndDate(startDate: string): string {
  const [year, month, day] = startDate.split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1, day) + 7 * 86_400_000);
  return end.toISOString().slice(0, 10);
}

/**
 * The Monday (YYYY-MM-DD) of the week containing `now`, evaluated in `timezone` - never inferred
 * permanently from the server's own timezone (contract rule). Calendar-date arithmetic only (UTC
 * midnight offsets), since start_date is a plain date with no time-of-day component.
 */
export function mondayStartOf(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>;
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(map.weekday);
  const daysSinceMonday = (weekdayIndex + 6) % 7;
  const utcMidnight = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day));
  const monday = new Date(utcMidnight - daysSinceMonday * 86_400_000);
  return monday.toISOString().slice(0, 10);
}
