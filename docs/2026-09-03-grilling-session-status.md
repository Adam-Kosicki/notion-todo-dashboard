# 2026-09-03 grilling session — decisions and status

This records the outcome of the `/grill-with-docs` session run against the user's large batch of feature requests, so work can resume without re-deriving context. Domain terms and architectural decisions from this session also live in [`CONTEXT.md`](../CONTEXT.md) and `docs/adr/0001-...`, `docs/adr/0002-...` — this file is the plain-language status/roadmap view.

## Decisions (all confirmed by the user unless noted)

1. **Groups vs. Tags are separate features**, not one mechanism. Group = hard merge with a combined attention score, moves as a unit. Tag = soft filterable label, items stay independent. (ADR 0002)
2. **Priority coloring = subtle background wash on the whole box**, not colored text. Text stays neutral for legibility.
3. **Lists: delete only, no archive tier.** Deleting a non-empty list warns the user and reassigns its items to Unsorted rather than deleting the items. Completed-task tracking is unaffected — it's the existing separate "Finished" tab. (ADR 0001)
4. **List field visibility (priority slider, "Long-term goals" section) is List-Type-driven with a per-list override.** Replaces the hardcoded "every list except literally 'Grocery'" rule. (ADR 0001, CONTEXT.md "List Type")
5. **"Active" (renamed from "Touched") keeps its manual button** *and* auto-updates on any real edit. Assistant's assumption, not explicitly re-confirmed after the user's answer numbering got scrambled in chat — flag if wrong.
6. **Quick-edit toolbar: all actions visible on hover, no overflow menu.** Assistant's tentative call, pending confirmation once the user's referenced screenshot (of a toolbar sizing problem) is actually seen — it never came through in this session.
7. **Dropdown → colored-blob pills: a per-picker setting**, not one global toggle. Each picker (list, type, tags, sort, filters, quick-add) gets its own switch between blob-style and native dropdown, in a settings page.
8. **Create-task flow is confusing mainly because of the multi-click dropdown tax** (open dropdown, then select, repeated per field). The user wants to experiment with alternatives rather than lock in a design now — this is exactly what decision 7's per-picker toggle is for. No final layout has been decided.

## Still missing / open

- **Three screenshots the user referenced were never actually received in this session**: (a) a list with a nonsensical "long-term goal"/priority setup, (b) a drag-and-drop grouping mockup, (c) a Quick Edit resize bug. (a) and the general shape of (c) turned out to be independently diagnosable from the code and are already fixed — see below — but (b) (the grouping/drag-drop UI reference) is still needed before Groups' interaction design is finalized.
- Combined-score formula for Groups (max vs. sum of members) is an unconfirmed assumption — see ADR 0002.
- Full settings-page layout (where all the per-picker toggles, sorting/filtering defaults, etc. live) has not been designed yet.

## Implementation status

**Done and verified live in the dev server (`npm run dev` via `D:\DevOps` node/npm, not on PATH by default — see below):**
- Priority/attention background wash on dashboard rows and collection rows (`app/globals.css`) — subtle gradient, not a flat marker.
- "Touched" → "Active" rename, everywhere in the UI (toolbar button, EditorSheet "Mark active now" / "Last active").
- Quick-edit panel now reveals on hover (no separate "Quick edit" click button) — the button and its `quickOpen` state were removed; CSS drives visibility the same way the rest of the hover toolbar already did.
- Resize bug root-caused and fixed: `.quick-editor-inner` had a hardcoded 5-column grid needing ~750px, but the "This week"/"Longer" dashboard panels are only 420–500px wide, so the fields were overflowing on 2 of 3 dashboard columns essentially always (not just at some narrow breakpoint). Replaced with `repeat(auto-fit, minmax(120px, 1fr))` so it adapts to whatever width it actually has.

**In progress, not working yet:**
- Date quick-toggle (replacing the old one-way "No date" button) — a `DateQuickPopover` component was added using the existing shadcn `Popover` + `Calendar` (react-day-picker), wired into the hover toolbar in `app/board-app.tsx`. It renders and shows the current due date, but clicking it does not open the calendar popover — `trigger.getAttribute('data-state')` stays `"closed"` after a click, and `[data-slot="popover-content"]` never appears in the DOM. Root cause not yet found; was mid-debugging (checked for console errors — only unrelated browser-extension noise; confirmed the Trigger/Content JSX structure is the standard Radix `asChild` pattern; confirmed `@radix-ui/react-popover`'s trigger composes `onClick` with `context.onOpenToggle` normally) when this status note was written. A stray `console.log` debug line was left in `DateQuickPopover`'s `onOpenChange`/trigger `onClick` in `app/board-app.tsx` — remove it once the popover bug is fixed.

**Not started:**
- `lists` table + migration, list management UI (create/edit type/toggle visibility/delete), fixing `CollectionsView`'s hardcoded exclusion to read from it. (ADR 0001)
- Tags: schema column, Notion multi-select mapping, blob-style multi-select UI, filter-bar integration.
- Groups: schema (`groupId`/group table), combined-score computation, merge/unmerge drag-and-drop UI, rendering merged bundles across Today/This week/Longer and list views.
- Settings page and the per-picker dropdown-vs-blob toggle system.
- Sorting/filtering settings beyond what already exists.
- Create-task flow redesign (blocked on decision 8 above — needs the user to react to a first concrete draft, not another round of questions).

## One environment note worth keeping
Node/npm are not on this machine's default PATH. A working install was found at `D:\DevOps` and added to `~/.bashrc` / `~/.bash_profile` (`export PATH="/d/DevOps:$PATH"`) for Git Bash. The dev server itself has to be started by invoking `./node_modules/.bin/vite` directly (with `WRANGLER_LOG_PATH` set via a real env var, not inline in the npm script) rather than `npm run dev`, because that script sets an env var using POSIX syntax (`WRANGLER_LOG_PATH=... vite`) that Windows' `cmd.exe` — npm's default script shell — can't parse.
