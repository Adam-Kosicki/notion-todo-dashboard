# 0002: Groups and Tags are two separate primitives, not one

## Status
Accepted — 2026-09-03

## Context
The user asked for two capabilities in the same request: (a) "combine tasks into one grouped thing... one big attention score... they move together... link and unlink," and (b) "drag and drop them together and label them as sports, filter tags... rename... ungroup... move around freely." Read literally, both could be built as a single "grouping" mechanism.

## Decision
Build them as two independent primitives instead:

- **Group** — a hard merge. Member items collapse into one bundle with a single combined attention score and move together as a unit across every view. Created via an explicit "link" action, dissolved via "unlink".
- **Tag** — a soft, filterable label (e.g. "Sports"). Items keep their own attention score and position; a tag only affects what you can filter by. An item can carry multiple tags.

Tags follow the existing `context` field's implementation pattern (comma-separated text column, synced to a new Notion multi-select property), since that round-trips cleanly. Groups use a single `group_id` column on `items` with no group-metadata table: the first item merged becomes the "anchor" by self-referencing (`group_id = own id`); every other member points at that same id. No Notion equivalent — local-only, per the same constraint as [[0001-lists-become-real-entities]].

## Status update — 2026-09-04
Both implemented. Tags: schema, Notion sync, blob-pill picker UI. Groups: `group_id` column + `mergeItems`/`unlinkFromGroup`/`disbandGroup` server actions, drag-one-row-onto-another to merge (confirmed with the user: two clarifying questions resolved this open score-formula question and the display model — see Consequences), a single collapsed row that expands to show members, per-member unlink, and whole-group disband. Scoped to the Today/This week/Longer/Prioritize/Reminders/Finished views (`TaskTable`-based); the Lists+goals view still shows grouped items individually rather than collapsed — a deliberate v1 scope cut, not an oversight.

## Consequences
- Two separate schema and UI surfaces to build instead of one.
- Avoids the alternative's real failure mode: under a single unified mechanism, tagging a task "Sports" would either force it to lose its individual attention score, or physically stick it to every other "Sports" task's position — neither of which the user wants from a category label.
- Combined-score formula: **max** of members' effective attention (the most urgent member drives the group's visible urgency), confirmed with the user before implementation.
- Display model: one merged row that expands to show members, confirmed with the user before implementation — not individually-bracketed rows.
