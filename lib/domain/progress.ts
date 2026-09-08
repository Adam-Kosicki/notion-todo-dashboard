// Phase 3 (docs/plans/burner-board-roadmap.md, section 6 "Weekly statistics contract"). Pure,
// DB-free so every rule in the contract is directly unit-testable (tests/progress.test.mjs)
// without D1. lib/server/commands.ts's weekClose calls computeWeekStats once to produce the
// frozen snapshot stored in planning_weeks.report_json; nothing here reads or writes a database.

export type CommitmentInput = {
  itemId: string;
  withdrawnAt: string | null;
};

export type ItemEventInput = {
  itemId: string;
  eventType: "items.complete" | "items.reopen";
  timestamp: string;
};

/**
 * Astra review (Phase 3 slice 1 remediation, 7060176, repository.ts:275): re-adding a withdrawn
 * commitment refreshes `week_commitments.added_at` to the re-add time, which - when on-time
 * detection compared a completion only against that single snapshot column - erased a completion
 * that legitimately happened during an *earlier* active period (select Monday, complete Tuesday,
 * withdraw Wednesday, re-add Thursday used to flip 1/1 to 0/1, with no reopen involved). Fixed by
 * using the full week.commit/week.withdraw event history instead of one current-state column -
 * see computePeriodStats.
 *
 * Widened to also accept period.commit/period.withdraw (Phase 3 extension) when this function
 * was generalized from computeWeekStats - see COMMIT_EVENT_TYPES below for the "which of these
 * four literals means active" check this enables.
 */
export type CommitmentEventInput = {
  itemId: string;
  eventType: "week.commit" | "week.withdraw" | "period.commit" | "period.withdraw";
  timestamp: string;
};

const COMMIT_EVENT_TYPES = new Set<CommitmentEventInput["eventType"]>(["week.commit", "period.commit"]);

export type CommitmentItemInfo = {
  /** "Goal" and "Reference" are excluded from the task completion ratio (contract rule: "Goals
   * and reference records are excluded from the task ratio; show goal milestones separately"). */
  itemType: string;
};

export type PeriodStats =
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
/** @deprecated Use `PeriodStats` - kept as an alias since the weekly path still imports this name. */
export type WeekStats = PeriodStats;

/**
 * Astra review (Phase 3 Slice 1, c02e352, first round): the original implementation compared raw
 * event timestamps against plain `startDate`/`endDate` calendar-date strings, which is both
 * timezone-naive (a timestamp string like "2026-09-07T04:30:00Z" lexicographically compares as
 * >= the date-only string "2026-09-07", even though 04:30 UTC is still Sunday night in Chicago)
 * and ignored per-week event-history bounding. Fixed by resolving the week's boundaries to real
 * UTC instants in the planning timezone via `zonedMidnightUtc`, and evaluating each week's
 * on-time contribution only from events that happened before that week's own end instant, so a
 * reopen event that happens in a *later* week can no longer retroactively erase an earlier,
 * already-elapsed week's completion (only a reopen inside the same week reverses it, per
 * contract). Late-completion detection looks at the full history separately.
 *
 * Astra review (remediation round, 7060176^..1698bc8): the first round's fix still gated on-time
 * credit with a single `commitment.addedAt >= ...` comparison - a static current-state snapshot
 * that a later re-add's refreshed `added_at` could invalidate for a completion that legitimately
 * happened during an *earlier* active period (repository.ts:275's finding). Fixed by replaying
 * the item's full `week.commit`/`week.withdraw` history (`commitmentEvents`) alongside its
 * complete/reopen history and tracking an `isActive` flag: a completion only counts toward
 * on-time credit if the item was actively committed (a `week.commit` has fired and no
 * `week.withdraw` since) at the moment it happened - "count completion events inside the week
 * after commitment selection" now means "while actually selected," not merely "after the most
 * recent selection timestamp." An item with no commit/withdraw history at all (data predating
 * this event's introduction) is treated as active throughout, matching the previous behavior.
 */
/**
 * Renamed from `computeWeekStats` (Phase 3 extension, docs/adr/local/time-horizon-quick-actions.md):
 * this was already period-shape-agnostic - it only ever consumed `{startDate,endDate,timezone}`
 * plus event history, never anything week-specific - so the Today/Month/Year period system
 * (lib/server/commands.ts's periodCommitPlan/periodWithdrawPlan) reuses it as-is rather than
 * duplicating this logic three more times. No behavior change from the reviewed weekly version.
 */
export function computePeriodStats(params: {
  period: { startDate: string; endDate: string; timezone: string };
  commitments: CommitmentInput[];
  itemsById: Record<string, CommitmentItemInfo>;
  events: ItemEventInput[];
  commitmentEvents: CommitmentEventInput[];
}): PeriodStats {
  const { period, commitments, itemsById, events, commitmentEvents } = params;
  if (commitments.length === 0) {
    return { status: "no_commitments", label: "No tasks planned" };
  }

  const weekStartInstant = zonedMidnightUtc(period.startDate, period.timezone);
  const weekEndInstant = zonedMidnightUtc(period.endDate, period.timezone);

  type Timestamped = { timestamp: string };
  const byItem = <T extends Timestamped & { itemId: string }>(list: T[]): Map<string, T[]> => {
    const map = new Map<string, T[]>();
    for (const entry of list) {
      const bucket = map.get(entry.itemId) ?? [];
      bucket.push(entry);
      map.set(entry.itemId, bucket);
    }
    for (const bucket of map.values()) bucket.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return map;
  };
  const eventsByItem = byItem(events);
  const commitmentEventsByItem = byItem(commitmentEvents);

  /**
   * Replays complete/reopen events merged with commit/withdraw events, chronologically up to
   * (but not including) `cutoff`, and returns the item's completion timestamp as of that cutoff -
   * or null if not completed, or completed while not actively committed. `items.reopen` always
   * clears it (matches the pre-remediation rule: reopening undoes completion regardless of
   * commitment state); `items.complete` only sets it while `isActive`. `week.withdraw` does NOT
   * clear a standing completion - withdrawing isn't reopening.
   */
  const completionAsOf = (itemId: string, cutoff: string): string | null => {
    const itemCommitmentEvents = commitmentEventsByItem.get(itemId) ?? [];
    const itemStatusEvents = eventsByItem.get(itemId) ?? [];
    const merged = [
      ...itemCommitmentEvents.map((event) => ({ ...event, kind: "commitment" as const })),
      ...itemStatusEvents.map((event) => ({ ...event, kind: "status" as const })),
    ]
      .filter((event) => event.timestamp < cutoff)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // No selection history at all (data predating week.commit/week.withdraw event emission) -
    // treat as always active, matching the pre-remediation behavior for such rows.
    let isActive = itemCommitmentEvents.length === 0;
    let completedAt: string | null = null;
    for (const event of merged) {
      if (event.kind === "commitment") {
        isActive = COMMIT_EVENT_TYPES.has(event.eventType);
      } else if (event.eventType === "items.complete") {
        completedAt = isActive ? event.timestamp : null;
      } else {
        completedAt = null;
      }
    }
    return completedAt;
  };

  let taskCommitments = 0;
  let completed = 0;
  let lateCompletions = 0;
  let goalMilestonesCompleted = 0;

  for (const commitment of commitments) {
    const info = itemsById[commitment.itemId];
    const isTask = info ? info.itemType !== "Goal" && info.itemType !== "Reference" : true;
    if (isTask) taskCommitments++;

    // On-time contribution: the item's completion state as of the end of THIS week's window
    // only - events from a later week (e.g. a reopen the following week) must never reach back
    // and change an already-elapsed week's outcome (contract: "Closing a week freezes its
    // report. Later edits do not rewrite historical reports" - and even before closing, a later
    // week's events aren't "within" this week).
    const completedAsOfWeekEnd = completionAsOf(commitment.itemId, weekEndInstant);
    const onTime = completedAsOfWeekEnd !== null && completedAsOfWeekEnd >= weekStartInstant;

    if (onTime) {
      if (isTask) completed++;
      else goalMilestonesCompleted++;
      continue;
    }

    if (!isTask) continue;

    // Not on-time: a completion that still stands (not itself since reversed by a reopen) and
    // lands at/after this week's end is a late completion - contract: "Completion outside the
    // week is shown as late completion, not rewritten as on-time success." Unbounded cutoff (a
    // timestamp guaranteed to sort after anything real) to see the full history.
    const finalState = completionAsOf(commitment.itemId, "9999-12-31T23:59:59.999Z");
    if (finalState !== null && finalState >= weekEndInstant) lateCompletions++;
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

/** @deprecated Thin `{week: ...}` -> `{period: ...}` forwarder kept only so tests/progress.test.mjs's existing Astra-reviewed fixtures (which predate the rename) keep working unmodified. New callers should use `computePeriodStats` directly. */
export function computeWeekStats(params: {
  week: { startDate: string; endDate: string; timezone: string };
  commitments: CommitmentInput[];
  itemsById: Record<string, CommitmentItemInfo>;
  events: ItemEventInput[];
  commitmentEvents: CommitmentEventInput[];
}): PeriodStats {
  const { week, ...rest } = params;
  return computePeriodStats({ period: week, ...rest });
}

/** Exclusive end of the week starting on `startDate` (a YYYY-MM-DD calendar date). */
export function weekEndDate(startDate: string): string {
  const [year, month, day] = startDate.split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1, day) + 7 * 86_400_000);
  return end.toISOString().slice(0, 10);
}

/**
 * The UTC instant of local midnight on `dateStr` (a YYYY-MM-DD calendar date) in `timezone`.
 * Uses the standard "guess UTC midnight, ask the timezone what wall-clock time that instant
 * reads as, then correct by the resulting offset" double-conversion - the same technique
 * `mondayStartOf` already uses via `Intl.DateTimeFormat`, which resolves the correct UTC offset
 * for that specific calendar date (so DST transitions are handled correctly, unlike a fixed
 * offset lookup).
 */
export function zonedMidnightUtc(dateStr: string, timezone: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(guess));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>;
  // Midnight can render as "24:00:00" in this formatter depending on the runtime; normalize.
  const hour = Number(map.hour) % 24;
  const wallClockAsUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second));
  const offsetMs = wallClockAsUtc - guess;
  return new Date(guess - offsetMs).toISOString();
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

/** `now`'s calendar date (year/month/day), evaluated in `timezone` - the same zoned-lookup step `mondayStartOf` inlines, shared here for the day/month/year boundary helpers below. */
function zonedCalendarParts(now: Date, timezone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>;
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

// --- Phase 3 extension: Today/Month/Year period boundaries -------------------------------------
// Each pair mirrors mondayStartOf/weekEndDate's shape (a YYYY-MM-DD start plus an exclusive
// YYYY-MM-DD end, both evaluated via zonedCalendarParts/UTC calendar-date arithmetic, never
// day-counting through variable month lengths) - see lib/server/queries.ts's
// getOrCreateCurrentPlanningPeriod for where these get selected by period type.

/** Today's calendar date (YYYY-MM-DD) in `timezone`. */
export function dayStartOf(now: Date, timezone: string): string {
  const { year, month, day } = zonedCalendarParts(now, timezone);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** Exclusive end of the day starting on `startDate` - the next calendar day. */
export function dayEndDate(startDate: string): string {
  const [year, month, day] = startDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + 86_400_000).toISOString().slice(0, 10);
}

/** The first day (YYYY-MM-01) of the calendar month containing `now`, in `timezone`. */
export function monthStartOf(now: Date, timezone: string): string {
  const { year, month } = zonedCalendarParts(now, timezone);
  return new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
}

/** Exclusive end of the month starting on `startDate` - the first day of the next month (UTC year/month arithmetic, not day-counting, so it's correct across every month length). */
export function monthEndDate(startDate: string): string {
  const [year, month] = startDate.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

/** January 1 (YYYY-01-01) of the calendar year containing `now`, in `timezone`. */
export function yearStartOf(now: Date, timezone: string): string {
  const { year } = zonedCalendarParts(now, timezone);
  return new Date(Date.UTC(year, 0, 1)).toISOString().slice(0, 10);
}

/** Exclusive end of the year starting on `startDate` - January 1 of the next year. */
export function yearEndDate(startDate: string): string {
  const [year] = startDate.split("-").map(Number);
  return new Date(Date.UTC(year + 1, 0, 1)).toISOString().slice(0, 10);
}

export type PeriodType = "day" | "month" | "year";

/** Picks the right *StartOf helper by period type - the one place callers branch on period type for boundary computation. */
export function periodStartOf(periodType: PeriodType, now: Date, timezone: string): string {
  if (periodType === "day") return dayStartOf(now, timezone);
  if (periodType === "month") return monthStartOf(now, timezone);
  return yearStartOf(now, timezone);
}

/** Picks the right *EndDate helper by period type, matching periodStartOf. */
export function periodEndDate(periodType: PeriodType, startDate: string): string {
  if (periodType === "day") return dayEndDate(startDate);
  if (periodType === "month") return monthEndDate(startDate);
  return yearEndDate(startDate);
}
