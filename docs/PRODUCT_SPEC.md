# Burner Board product specification

## Purpose

Burner Board is a fast editing layer for a Notion task database. It should take seconds to sort, rename, date, tag, complete, archive, or touch an item. The full record still opens when deeper editing is needed.

## Source of truth

- Notion is the long-term database and canonical record once its integration is connected.
- The Site keeps a private D1 working copy so it remains fast and preserves edits between sessions.
- Changes write through to Notion when the connection is active. Unsynced changes remain marked for a later retry.
- Reminder metadata uses the existing `Original Notes` property in a clearly delimited Burner Board block. This avoids requiring new Notion properties for recurrence, reminder time, or date rules.

## Main planning flow

The Plan view has three tables in this order:

1. Today. Includes overdue items, items due or scheduled today, and the legacy Today list.
2. This week. Includes the remaining days through Sunday.
3. Longer. Includes priority-bearing work outside Today and This week, including work without a date.

Each table sorts by combined urgency, then stored attention, numeric priority, date, and name. A due date that is close or overdue raises effective attention. The row border, task name, and attention marker move from green to yellow to red as urgency rises.

Dragging an item into Today schedules it for today. Dragging it into This week schedules it for Sunday. Dragging it into Longer clears its active due and scheduled dates.

## Priority and non-task objects

- Actionable tasks use a 0 to 10 priority slider.
- Priority 0 is reserved for non-action or long-term objects.
- Goals, reminders, purchases, list items, someday items, and references do not show the priority slider.
- Grocery, Wish List, Bucket List, Monthly Payments, and Warranties remain their own tables instead of entering the prioritization queue.
- Prioritize shows only tasks with no priority and no collection, area, project, goal, or context.

## Quick interaction model

Hovering over a row exposes a toolbar. Touch devices show it by default.

- Done records a completion timestamp and moves the item to Finished.
- Touched records the current timestamp in `Last Interaction`.
- No date clears Due and Scheduled and marks the item as not needing a date.
- Quick edit expands an inline form for name, due date, date rule, tag or list, item type, details, and priority when applicable.
- Archive removes the item from active views. When Notion is connected, its page moves to Notion trash rather than being permanently deleted.
- Clicking the task name opens the full editor with every Notion field supported by the Site.

Every saved change updates `Last Interaction` automatically. Explicitly marking an item as touched exists for days when progress happened without another field changing.

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
