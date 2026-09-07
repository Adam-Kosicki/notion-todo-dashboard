# 0003: List Type doesn't do what users expect; item type may need to own this instead

## Status
Deferred — 2026-09-06. Not decided, not implemented. Left for GPT ASTRA to figure out.

## Context
User report: they changed the "Wish List" list's Type from "Reference / someday" to "Shopping / things to buy", expecting the items already in that list to become Purchases. They didn't. Nothing broke — this is working as designed, per an earlier confirmed decision: List Type only supplies `defaultItemType`, a **soft default** that pre-fills the itemType of items newly moved into the list; it never rewrites items already there, and an explicit itemType always wins (see [[0001-lists-become-real-entities]]). The design is sound but the UI gives no indication anywhere that changing a list's Type is forward-only, not a retroactive relabel. From the user's side this reads as a bug.

Compounding it: "Someday" is three different overlapping things in this codebase today:
1. A `Burner` value (`"Unsorted" | "Front Burner" | "Simmering" | "Back Burner" | "Someday"`) — the original prioritization model the app (Burner Board) is named after.
2. One of the eight `ITEM_TYPES` values.
3. Folded into the "reference" List Type's display label, "Reference / someday" (`LIST_TYPES` in `lib/board-types.ts`).

A user setting a list's type or an item's type runs into "someday" meaning three unrelated things depending on which control they touched. The user's exact words: "what the fuck even is 'someday' that's confusing."

## The user's proposed direction (not yet a decision)
Given both of the above, the user is now questioning List Type as a concept at all:

- A list should just be a plain container for tasks. Creating a new list should default straight to a general list, no type picker up front.
- The thing that carries "kind of thing this is" should live on the **item** (itemType: Task/Goal/Reminder/Event/Purchase/List item/Someday/Reference), not the list.
- Further: when an item's type is something other than a plain Task, the user is leaning toward it not living inside a general list at all — instead surfacing in its own dedicated area, the way Events were just pulled out to a dedicated Calendar page this session, and the way Goals now have a dedicated Goals page that shows every goal regardless of any list's visibility setting.

This would generalize a pattern that already exists in inconsistent, partial forms:
- **Event** — hard-excluded from every list unconditionally (`belongsToList()` in `lib/list-behavior.ts` returns `false` for any Event, full stop), with its own Calendar tab.
- **Goal** / **Purchase** — soft per-list show/hide toggle (tri-state, default from a global Home setting), still eligible to live inside a regular list when shown; Goal additionally has a dedicated Goals tab that always lists every goal regardless of the toggle.
- **Reminder** — has its own tab, but is not excluded from general lists the way Event is.
- **Task**, **List item**, **Someday**, **Reference** — no special placement at all today.

Three different behaviors for "what happens to a non-Task item type" is itself part of the confusion.

## Why this isn't being decided now
This is a real architecture question, not a bug fix: removing or de-emphasizing List Type touches list creation (`NewListCard`), list management (`ListManagePopover`'s "List type" field and its tri-state toggles), `createList`/`updateList` validation in `lib/server/board-store.ts`, and the placement rules in `lib/list-behavior.ts`. It also has to reconcile with the visibility toggles and Goals page shipped this same session — those assume lists keep a Type. Deciding this properly needs its own pass, not a reactive patch on top of a bug report.

## Open questions for that pass
- Remove List Type outright, or just de-emphasize it (default silently to "general" on creation, move the picker into an "advanced" corner of Manage)?
- Does the Event-style hard exclusion generalize to Reminder and Purchase too, or does Goal/Purchase keep the softer per-list toggle shipped this session? Should the three placement behaviors converge on one rule?
- If an item's type change (e.g. Task → Event) auto-evicts it from its current list, what happens to `item.collection` — cleared to null, or left as inert metadata?
- Should "Someday" be renamed or split to remove the Burner/itemType/list-type-label collision, independent of whatever happens to List Type itself?

## Consequences of leaving this open
- List Type will keep looking like it should retroactively reclassify items when it only pre-fills new ones, until either the UI explains the soft-default behavior or the type concept is removed as proposed.
- The "Someday" naming collision (burner status vs. item type vs. list-type label) stays confusing until addressed on its own or as part of this.
