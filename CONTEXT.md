# Burner Board — Domain Glossary

## Item
A single task/todo/reminder/goal/etc. Stored in the `items` table. Has a `priority` (0–10 importance, null = unrated), an `attentionScore`/`effectiveAttention` (computed urgency blending priority and due date), an `itemType` (Task/Goal/Reminder/Purchase/List item/Someday/Reference), and a `collection` (which List it belongs to, if any).

## List
A named grouping of Items, shown as a column in "Lists + goals" and used as the `collection` value on an Item. A real table (`lists`), carrying its own **List Type** and field-visibility flags, separate from the item rows that reference it by name.

- Deleting a List does not delete its Items — they fall back to no list (`collection = null`). No "archive" state for Lists; only delete. (Archiving already exists at the *Item* level via `status = "Archived"`, unrelated to List archiving — see **Item Archive**.)

## List Type
A per-List classification that drives *default* field visibility for that list (e.g. whether the "Long-term goals" and "Prioritized/No-priority" subtables make sense to show). Replaces the old hardcoded special-case (`name !== "Grocery"`) that excluded only one specific list by name.

- Each List Type has sensible defaults for `showPriority` / `showLongTermGoals`.
- Any individual List can override its type's defaults (e.g. force priority visible/invisible, independent of type). Overriding to "invisible" also treats priority as null for that list's items in the UI.

## Item Archive
Existing per-Item `status = "Archived"` — a reversible, recoverable removal of a single Item from active views (distinct from List deletion, and distinct from `status = "Done"`/the Finished tab, which is completion-tracking).

## Active (formerly "Touched")
`lastInteraction` timestamp on an Item. Renamed in the UI from "Touched" to "Active". Auto-updates on **any** save to the item (already server-side behavior in `updateItem`), plus a manual "Active" button to bump it without changing anything else.

## Tag
A lightweight, independent label (e.g. "Sports") attachable to any Item for filtering. Distinct from **Group** — an Item's Tags don't affect its individual attention score or position. Many-to-many in spirit; implemented as a comma-separated field the same way `context` already works, so it can round-trip to Notion as a multi-select property.

## Group
A hard bundling of multiple Items into one unit that moves together and shares one combined attention score (max of members' effective attention). Distinct from **Tag**. Implemented via a single `groupId` column on `items`: the first Item merged becomes the **anchor** by self-referencing (`groupId = its own id`); every other member's `groupId` points at that same id. No group-metadata table. Local-only — Notion's schema is fixed/external, so Group membership never round-trips there.

- Displays as one collapsed row (the anchor's title + a "N tasks" badge) that expands to show every member as a normal, fully-interactive row.
- Formed by dragging one row directly onto another (in the Today/This week/Longer/Prioritize/Reminders/Finished views — the Lists+goals view doesn't collapse groups, a deliberate v1 scope cut).
- **Unlink** removes one member from its Group (auto-dissolves the Group if only the anchor is left). **Disband** breaks the whole Group apart at once.

## Attention color
The `heatColor()`/`--heat-color` CSS variable already computed per item from its effective attention (0–100 → hue). Rendered as a subtle whole-row background gradient wash (not just the small marker dot), intentionally kept low-opacity so the dashboard reads as "gently gradient-tinted," not high-contrast colored blocks.
