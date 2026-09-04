# Habit tracker — plan for future implementation

**Status: not started.** This is a design sketch to work from, not a spec to build against as-is — the open questions at the bottom need answers (ideally a short grilling session) before implementation begins.

## Why this doesn't fit the existing Reminder model

Burner Board already has recurring items (`itemType: "Reminder"`, with `recurrence` + `reminderTime`), but that model tracks **one item with one schedule** — a single `status`/`completedAt`. It answers "is this due" and "was it done," not "did I do this on each of the last 30 days" or "what's my current streak." A habit tracker needs a **history of per-occurrence completions**, which is a different shape of data, not just a new `itemType`.

## Proposed domain model

- **Habit**: a recurring thing you're tracking (e.g. "Drink water," "Read 20 minutes"), with a cadence (daily, N times/week, specific weekdays), independent of the `items` table entirely — not a task, not a reminder.
- **Habit log entry**: one row per day (or per occurrence) recording whether/how much the habit was done that day. Append-only, one row per habit per date.
- **Streak**: derived, not stored — computed from log entries at read time (current streak, longest streak, completion rate over a window). Storing it directly invites drift bugs whenever a log entry is added/edited/deleted retroactively.

## Proposed schema

```
habits
  owner_id, id (pk together)
  name
  cadence            -- "daily" | "weekly" | "custom" (see open questions)
  target_per_period   -- e.g. 1 for daily, 3 for "3x/week"
  color               -- for the UI, same hash-based approach as tags, or user-picked
  archived            -- boolean; habits, like lists, should support archiving/deleting
  sort_order
  created_at, updated_at

habit_logs
  owner_id, habit_id, date (pk together — one row per habit per day)
  completed           -- boolean, or a count if habits support partial credit
  note                -- optional short note
  logged_at
```

Kept deliberately separate from `items`/`lists` rather than shoehorned into either — a habit isn't a task with a due date, and streak math doesn't belong in the same table as one-off completions.

## UI concepts

- A new **Habits** view/tab, parallel to Plan / Prioritize / Lists+goals / Reminders / Finished.
- Each habit shown as a row with a week-strip or small calendar-heatmap (like GitHub's contribution graph, scoped to one habit) and the current streak.
- Quick-log interaction: tapping today's cell toggles it done/not-done, no navigation — same spirit as the existing hover quick-toolbar on task rows.
- Possibly a small "Today's habits" panel on the main dashboard next to Today/This week/Longer, so logging doesn't require leaving the primary view.

## Notion sync

Like Groups, this doesn't map cleanly to Notion's schema: a `habit_logs` table could in principle become its own related Notion database, but that's a lot of child pages for daily logs and isn't something to take on for a first version. Plan: **local-only (D1) for the first implementation**, same as Lists' type/visibility fields. A Notion-backed log (one page per habit per day, or a rollup property) can be a later, explicitly opt-in integration if it turns out to matter.

## Suggested phasing

1. **Phase 1** — schema + backend CRUD (habits, habit_logs), streak/completion-rate computation, no UI polish yet. Local-only, no Notion sync.
2. **Phase 2** — Habits view/tab with the week-strip/heatmap and quick-log toggle.
3. **Phase 3** (optional, later) — dashboard integration (Today's habits panel), and only then consider Notion sync if it's actually wanted.

## Open questions to resolve before building

- **Cadence flexibility**: daily-only to start, or build N-times-per-week / specific-weekdays from day one? Affects the schema's `cadence`/`target_per_period` shape.
- **Partial credit**: strictly done/not-done per day, or a count (e.g. "drank 6/8 glasses")?
- **Missed days**: does missing a day reset the streak immediately, or is there a grace mechanism (e.g. 1 free miss per week)?
- **Relationship to attention scoring**: should an overdue/neglected habit ever surface in the existing attention-color system, or stay fully separate from task urgency?
- **Where it lives in the nav**: a full new tab, or folded into Reminders as a sub-mode?
