# 0001: Lists become a real, first-class entity instead of derived strings

## Status
Accepted — 2026-09-03

## Context
A List (collection) currently exists only as a freeform string on `items.collection`. The set of lists shown anywhere in the app is derived at read time: `[...new Set(items.map(i => i.collection))]` (`getBoard`, `lib/server/board-store.ts`). There is no row anywhere that represents "a list" — so there is nowhere to attach per-list configuration.

This produced a real bug the user found by inspection: `CollectionsView` (`app/board-app.tsx`) decides whether to show a "Long-term goals" section and a priority column with a single hardcoded check, `name !== "Grocery"`. Every list except the one literally named "Grocery" gets long-term-goal and priority treatment — including Wish List, Bucket List, and Monthly Payments, where it doesn't make sense.

Separately, the user wants to: delete lists they no longer need, assign each list a Type (Goal, Shopping, Recurring Payment — with its own reminder defaults — etc.), and independently control whether the priority slider is visible or forced to null per list. None of this is possible while a list is just a derived string with no identity.

## Decision
Add a `lists` table, scoped by owner, storing: id, name, type, per-field visibility overrides (priority, long-term-goals), and reminder defaults (for Recurring Payment-type lists). List Type supplies sensible defaults for field visibility; an individual list can override its type's defaults.

Deleting a list is a hard delete — there is no archive tier for lists (unlike items, which already have an Archived status). If the list still has items when deleted, the user is warned and those items' `collection` is cleared to null (they fall back to Unsorted) rather than the items themselves being deleted. This follows the user's explicit answer ("instead of an archive we just have a delete") while avoiding silent data loss.

## Consequences
- Requires a schema migration and rewriting `getBoard`'s derived-collections logic to read from `lists` instead of computing a `Set` from items.
- New list-level fields (type, visibility overrides, reminder defaults) have no equivalent Notion property. Per `notionProperties()` in `lib/server/board-store.ts`, every synced field maps to one specific, pre-existing Notion property name. These new fields will be **local-only** (SQLite) and will not round-trip to Notion. This is different from item-level additions like Tags (see [[adr-0002-groups-and-tags-are-separate]]), which can map to a new Notion multi-select property the same way `context` does.
- Completed-task tracking is unaffected by any of this — it already exists as the separate "Finished" tab / Done status and was intentionally left alone.
