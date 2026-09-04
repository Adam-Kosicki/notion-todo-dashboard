# Burner Board product specification

## Purpose

Burner Board is a fast editing layer for a Notion task database. It should take seconds to sort, rename, date, tag, complete, archive, or touch an item. The full record still opens when deeper editing is needed.

## Source of truth

- Notion is the long-term database and canonical record once its integration is connected.
- The Site keeps a private D1 working copy so it remains fast and preserves edits between sessions.
- Changes write through to Notion when the connection is active. Unsynced changes remain marked for a later retry.
- Reminder metadata uses the existing `Original Notes` property in a clearly delimited Burner Board block. This avoids requiring new Notion properties for recurrence, reminder time, or date rules.

## Main planning flow

Plan and Lists+goals are merged into one **Home** page, top to bottom:

1. **Inbox** (renamed from "Prioritize"). Tasks with no priority and no collection, area, project, goal, or context — the landing zone every quick capture falls into until it's given at least one of those. Leaving Inbox happens automatically the moment any of those fields is set; there's no separate "processed" flag.
2. **Today.** Overdue items, items due or scheduled today, and the legacy Today list.
3. **This week.** The remaining days through Sunday.
4. **Longer.** Priority-bearing work outside Today and This week, including work without a date.
5. **Lists.** Every list as a compact, collapsed-by-default card (name, open/shown counts, manage gear) — click one to expand and see its items. Nothing else on the page depends on a list being expanded; it's purely a display state.

Today/This week/Longer each sort by combined urgency, then stored attention, numeric priority, date, and name. A due date that is close or overdue raises effective attention. The row border, task name, and the row's whole background (a subtle gradient wash, not just the marker dot) move from green to yellow to red as urgency rises.

Dragging an item into Today schedules it for today. Dragging it into This week schedules it for Sunday. Dragging it into Longer clears its active due and scheduled dates. Since Inbox, Today/Week/Longer, and Lists are all on the same page now, dragging an Inbox item straight into a List card (or vice versa) works directly, no navigating between views first.

The nav is just Home / Reminders / Finished — there's no separate "Prioritize" or "Lists + goals" destination anymore, both live inside Home.

## Priority and non-task objects

- Actionable tasks use a 0 to 10 priority slider.
- Priority 0 is reserved for non-action or long-term objects.
- Goals, reminders, purchases, list items, someday items, and references do not show the priority slider.
- Whether a list shows the priority queue (Prioritized / No priority / Long-term goals) or a flat Items list is driven by that **List's Type** (see below), not a hardcoded list name. Grocery, Wish List, Bucket List, Monthly Payments, and Warranties get this behavior today because they were inferred into non-priority types on first load — any list can be reconfigured from its own manage popover.
- Inbox shows only tasks with no priority and no collection, area, project, goal, or context.

## Lists

Lists are a real, per-owner entity (`lists` table), not just derived strings. Each List has:

- A **name** (what items' `collection` field matches).
- A **List Type**: General, Goals, Shopping, Recurring payments, or Reference — each with defaults for whether the priority slider and the Long-term goals subtable are shown.
- Optional **per-list overrides** of those two visibility flags (Default / On / Off), so an individual list can diverge from its type's default.
- A **reminder default** (only surfaced for Recurring payments lists).

Manage a list — rename, change type, toggle visibility, or delete — from the gear icon on its card header in "Lists + goals". Deleting a list is permanent (no archive state for lists); any items still in it fall back to no list rather than being deleted. List-level fields (type, visibility overrides, reminder default) are local-only and do not round-trip to Notion, since they have no corresponding Notion property — only each item's own `collection` string does.

## Tags

Tags are a lightweight, independent multi-select field on each item (`tags`, comma-separated, same shape as `context`), edited as colored blob pills you click to toggle or type to add. They're for cross-cutting filtering (e.g. "Sports") and don't affect an item's priority, position, or list membership. Tags sync to Notion as a "Tags" multi-select property when Notion is connected — if that property doesn't exist yet in the user's database, the Notion push for tag changes fails gracefully (the change stays saved locally) until the property is added there.

## Groups

A Group is a hard merge of two or more items into one unit with a single combined attention score (the max of members' effective attention — the most urgent member drives the group's visible urgency). Distinct from Tags: grouping affects display and urgency, not just filtering.

- Form a Group by dragging one task row directly onto another (in Today, This week, Longer, Prioritize, Reminders, or Finished — not in Lists + goals, which still shows grouped items individually).
- A Group displays as one collapsed row (the first-merged item's title, plus an "N tasks" badge) that expands on click to show every member as a normal, fully-interactive row — complete, edit, or drag any member independently.
- **Unlink** (on a member row inside an expanded group) removes just that item from the group; if only one member is left, the group dissolves automatically. **Disband** (on the collapsed group row) breaks the whole group apart at once.
- Local-only: Groups have no Notion equivalent and never round-trip there.

## Quick interaction model

Hovering over a row exposes both a compact action toolbar and the full inline quick-edit form together — there is no separate "Quick edit" click to expand it.

- Done records a completion timestamp and moves the item to Finished.
- Active records the current timestamp in `Last Interaction` (renamed from "Touched"). Every saved change updates it automatically regardless of which button is used; the manual button exists for days when progress happened without another field changing.
- The date action shows "Add date" (opens a small calendar popover to set one) when the item has no date, or the date itself (opens the same popover, pre-filled, with a Clear-date option) when it does — a single control for both directions, not a one-way clear button.
- The inline form covers name, due date, date rule, list, item type, details, tags, and priority when applicable.
- Archive removes the item from active views. When Notion is connected, its page moves to Notion trash rather than being permanently deleted.
- Clicking the task name opens the full editor with every Notion field supported by the Site.

## Completion and productivity

- Done and Archived are separate states.
- Done items count toward the productivity totals.
- The Finished view shows total completions, completions during the last seven days, and completions during the current month.
- Archived items remain visible in a separate table and can be reopened. Reopening also restores a connected Notion page from trash.
- Reopening a completed item clears its completion timestamp.

## Reminders

Reminder is a dedicated item type and view. A reminder can store:

- due date;
- scheduled date;
- reminder time;
- repeat rule, including daily, weekdays, weekly, monthly, yearly, and custom;
- notes and the normal Notion relationships.

The current Site stores and edits the schedule. Notification delivery is a future integration. The intended options are Apple Reminders for native device notifications or Google Calendar for calendar-based recurrence. Burner Board should remain the editing interface and Notion should remain the database.

## Todoist behavior

- Every open item in Today is marked `Show in Todoist`.
- If Todoist is connected, Today items without a Todoist task are created there automatically.
- Moving an item to Today also queues it for Todoist immediately.
- Renames, details, priority, dates, and completion update the linked Todoist task.
- Archiving removes the linked Todoist task.
- Items outside Today can still be sent to Todoist manually from the full editor.

## Future integration work

1. Choose Apple Reminders or Google Calendar as the first notification delivery provider.
2. Add provider authentication and map recurrence, time zone, completion, and rescheduling behavior.
3. Keep provider IDs in Notion so reminder delivery remains idempotent.
4. Add a delivery status and retry log without exposing credentials or sensitive values.
5. Add optional weekly productivity summaries once completion history has enough reliable timestamps.
