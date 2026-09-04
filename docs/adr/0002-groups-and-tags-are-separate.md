# 0002: Groups and Tags are two separate primitives, not one

## Status
Accepted — 2026-09-03

## Context
The user asked for two capabilities in the same request: (a) "combine tasks into one grouped thing... one big attention score... they move together... link and unlink," and (b) "drag and drop them together and label them as sports, filter tags... rename... ungroup... move around freely." Read literally, both could be built as a single "grouping" mechanism.

## Decision
Build them as two independent primitives instead:

- **Group** — a hard merge. Member items collapse into one bundle with a single combined attention score and move together as a unit across every view. Created via an explicit "link" action, dissolved via "unlink".
- **Tag** — a soft, filterable label (e.g. "Sports"). Items keep their own attention score and position; a tag only affects what you can filter by. An item can carry multiple tags.

Tags will follow the existing `context` field's implementation pattern (comma-separated text column, synced to a new Notion multi-select property), since that round-trips cleanly. Groups will need new schema with no Notion equivalent (a `groupId` and/or group-metadata table) — see [[adr-0001-lists-become-real-entities]] for the same local-only-field constraint applying here.

## Consequences
- Two separate schema and UI surfaces to build instead of one.
- Avoids the alternative's real failure mode: under a single unified mechanism, tagging a task "Sports" would either force it to lose its individual attention score, or physically stick it to every other "Sports" task's position — neither of which the user wants from a category label.
- Open question, not yet resolved with the user: the combined-score formula for Groups. Current working assumption is **max** of members' effective attention (the most urgent member drives the group's visible urgency), not sum. This needs explicit confirmation before Groups is implemented.
